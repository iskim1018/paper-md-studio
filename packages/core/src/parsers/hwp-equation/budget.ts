/**
 * 변환 한 번의 작업량·중첩 한도 (새로 작성 — kordoc·hml-equation-parser 에는 없다).
 *
 * 변환은 REST·MCP 서버에서도 요청 스레드에서 동기로 돈다. 짝 찾기·항 읽기를
 * 선형으로 고쳤지만(token 색인·items 메모), 놓친 경로가 하나라도 남으면 수식
 * 하나가 이벤트 루프를 몇 분씩 막는다 (2026-10-03 실측: `"x^(".repeat(3300)`
 * 417초). 그래서 두 가지 상한을 둔다. 넘으면 변환을 포기하고, hwpEquationToLatex
 * 가 null 을 돌려 호출측이 원문을 코드로 남긴다 (내용은 잃지 않는다).
 *
 * - 작업량: 패스·재작성·탐색 루프가 토큰을 방문할 때마다 센다. 벽시계가 아니라
 *   방문 수라 같은 입력은 어느 기계에서나 같은 결과를 낸다.
 * - 중첩: 재귀 패스의 깊이. 실물 수식은 깊어야 수십 단계인데, 수천 단계면 콜
 *   스택이 넘치고(JIT 상태에 따라 성공·실패가 갈렸다) 단계마다 꼬리를 복사하는
 *   패스가 O(n·깊이) 가 된다.
 *
 * 계수기를 모든 보조 함수에 매개변수로 넘기면 시그니처가 전부 바뀌므로, 동기
 * 변환 한 번 동안만 유효한 모듈 범위 상태를 쓴다 (재진입이 없다). 예산 밖에서
 * 보조 함수를 직접 부르면(단위 테스트) 세지 않는다.
 */
import { type EqToken, isClose, isOpen, isValue } from "./tokens.js";

export class EquationTooComplexError extends Error {
  constructor(reason: string) {
    super(`수식이 너무 복잡해 변환하지 않았습니다: ${reason}`);
    this.name = "EquationTooComplexError";
  }
}

export interface BudgetLimits {
  /** 토큰 방문 수 상한 */
  readonly steps: number;
  /** 재귀·구조 중첩 깊이 상한 */
  readonly depth: number;
}

interface ActiveBudget {
  steps: number;
  depth: number;
  readonly maxDepth: number;
}

let active: ActiveBudget | null = null;

/** `run` 을 예산 안에서 실행한다. 넘으면 EquationTooComplexError 를 던진다 */
export function runWithinBudget<T>(limits: BudgetLimits, run: () => T): T {
  const outer = active;
  active = { steps: limits.steps, depth: 0, maxDepth: limits.depth };
  try {
    return run();
  } finally {
    active = outer;
  }
}

export function spendSteps(count: number): void {
  if (active === null) return;
  active.steps -= count;
  if (active.steps < 0) throw new EquationTooComplexError("작업량 한도 초과");
}

/** 재귀 한 단계를 연다 — 깊이 한도를 넘으면 던진다 */
export function descend<T>(run: () => T): T {
  const budget = active;
  if (budget === null) return run();
  if (budget.depth >= budget.maxDepth) {
    throw new EquationTooComplexError("중첩 한도 초과");
  }
  budget.depth += 1;
  try {
    return run();
  } finally {
    budget.depth -= 1;
  }
}

/** 구조 중첩(`{…}`·`\left…\right`·`\begin…\end`)의 최대 깊이 */
function structuralDepth(tokens: ReadonlyArray<EqToken>): number {
  let depth = 0;
  let deepest = 0;
  for (const token of tokens) {
    if (opensLevel(token)) {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (closesLevel(token)) {
      depth = Math.max(depth - 1, 0);
    }
  }
  return deepest;
}

function opensLevel(token: EqToken): boolean {
  return (
    isOpen(token) ||
    isValue(token, "\\left") ||
    (token.kind !== "literal" && token.value.startsWith("\\begin{"))
  );
}

function closesLevel(token: EqToken): boolean {
  return (
    isClose(token) ||
    isValue(token, "\\right") ||
    (token.kind !== "literal" && token.value.startsWith("\\end{"))
  );
}

/** 패스 사이에서 부른다 — 다음 패스의 재귀 깊이가 이 구조 깊이를 따른다 */
export function assertShallowEnough(tokens: ReadonlyArray<EqToken>): void {
  if (active === null) return;
  spendSteps(tokens.length);
  if (structuralDepth(tokens) > active.maxDepth) {
    throw new EquationTooComplexError("중첩 한도 초과");
  }
}
