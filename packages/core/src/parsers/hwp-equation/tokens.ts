/**
 * 한컴 수식 토큰과 중괄호 짝 찾기.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 findBrackets·findEnclosingBrackets
 * (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 OpenBapul/hml-equation-parser
 * `hulkReplaceMethod.py` 의 `_findBrackets` (Apache-2.0, Copyright 2018 Open Bapul).
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)): 문자열 인덱스를 뒤집어 거꾸로 찾던 방식을
 * 토큰 배열 위의 짝 찾기로 바꿨다. 찾은 짝은 배열별로 기억해(token-memo.ts)
 * 같은 그룹을 다시 훑지 않는다 — 호출마다 끝까지 훑으면 같은 꼬리를 거듭
 * 읽는 입력에서 변환이 O(n³) 이 됐다. 중괄호는 렉싱 직후 균형을 맞춰 두므로
 * 이후 단계는 짝이 항상 있다고 가정할 수 있다 (없으면 -1 로 방어).
 */
import { MEMO_KIND, recall, remember } from "./token-memo.js";

/**
 * - atom: 단어·숫자·명령 (공백 없이 붙어 있으면 한 항으로 묶인다)
 * - symbol: 연산자·문장부호·구조 문자 (항을 끊는다)
 * - literal: `\text{}` 로 감쌀 원문 (따옴표 리터럴, 한글)
 */
export type EqTokenKind = "atom" | "symbol" | "literal";

export interface EqToken {
  readonly value: string;
  readonly kind: EqTokenKind;
  /** 원문에서 바로 앞에 공백이 있었는가 — 항 묶기와 출력 간격에 쓴다 */
  readonly gap: boolean;
}

export function makeToken(
  value: string,
  kind: EqTokenKind = "symbol",
  gap = true,
): EqToken {
  return { value, kind, gap };
}

/** 리터럴이 아닌 토큰의 값이 `value` 인가 */
export function isValue(token: EqToken | undefined, value: string): boolean {
  return (
    token !== undefined && token.kind !== "literal" && token.value === value
  );
}

export function isOpen(token: EqToken | undefined): boolean {
  return isValue(token, "{");
}

export function isClose(token: EqToken | undefined): boolean {
  return isValue(token, "}");
}

/**
 * `open` 에서 앞으로 훑어 짝 닫는 토큰의 위치를 찾는다. 없으면 -1.
 *
 * 훑는 동안 만난 안쪽 짝도 함께 기억하고, 이미 아는 안쪽 짝은 통째로
 * 건너뛴다 — 한 배열에서 짝 찾기를 몇 번 하든 합쳐서 O(n) 이다. 앞에서부터
 * 깊이를 세던 예전 방식과 같은 짝이다 (여는 쪽이 짝이 없으면 바깥도 없다).
 */
export function matchForward(
  tokens: ReadonlyArray<EqToken>,
  open: number,
  kind: number,
  opens: TokenTest,
  closes: TokenTest,
): number {
  const known = recall(tokens, kind, open);
  if (known !== undefined) return known;
  const scan: PairScan = { tokens, kind, opens, closes, pending: [open] };
  let i = open + 1;
  while (i !== NO_PAIR && i < tokens.length && scan.pending.length > 0) {
    i = pairStep(scan, i);
  }
  if (scan.pending.length === 0) return recall(tokens, kind, open) ?? NO_PAIR;
  for (const unmatched of scan.pending) {
    remember(tokens, kind, unmatched, NO_PAIR);
  }
  return NO_PAIR;
}

type TokenTest = (token: EqToken | undefined) => boolean;

/** 짝 찾기 한 번의 훑기 — 짝이 아직 없는 여는 토큰을 쌓는다 */
interface PairScan {
  readonly tokens: ReadonlyArray<EqToken>;
  readonly kind: number;
  readonly opens: TokenTest;
  readonly closes: TokenTest;
  readonly pending: Array<number>;
}

const NO_PAIR = -1;

/** 한 걸음 — 다음 위치, 또는 안쪽이 짝이 없어 바깥도 없음이 확정되면 NO_PAIR */
function pairStep(scan: PairScan, index: number): number {
  const token = scan.tokens[index];
  if (scan.opens(token)) {
    const inner = recall(scan.tokens, scan.kind, index);
    if (inner === undefined) {
      scan.pending.push(index);
      return index + 1;
    }
    return inner < 0 ? NO_PAIR : inner + 1;
  }
  if (scan.closes(token)) {
    remember(scan.tokens, scan.kind, scan.pending.pop() ?? index, index);
  }
  return index + 1;
}

/** `open` 위치의 `{` 와 짝인 `}` 의 인덱스. 없으면 -1 */
export function findClose(
  tokens: ReadonlyArray<EqToken>,
  open: number,
): number {
  if (!isOpen(tokens[open])) return -1;
  return matchForward(tokens, open, MEMO_KIND.brace, isOpen, isClose);
}

/** `[start, end)` 가 정확히 중괄호 그룹 하나인가 */
export function isSingleGroup(
  tokens: ReadonlyArray<EqToken>,
  start: number,
  end: number,
): boolean {
  return isOpen(tokens[start]) && findClose(tokens, start) === end - 1;
}

/** 짝 없는 `}` 를 버리고 닫히지 않은 `{` 를 끝에서 닫는다 */
export function balanceBraces(tokens: ReadonlyArray<EqToken>): Array<EqToken> {
  const balanced: Array<EqToken> = [];
  let depth = 0;
  for (const token of tokens) {
    if (isClose(token)) {
      if (depth === 0) continue;
      depth -= 1;
    } else if (isOpen(token)) {
      depth += 1;
    }
    balanced.push(token);
  }
  const closers = Array.from({ length: depth }, () => makeToken("}"));
  return [...balanced, ...closers];
}
