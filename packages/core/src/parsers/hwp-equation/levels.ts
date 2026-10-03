/**
 * over·atop 을 감싸는 그룹(수준) 추적 (새로 작성 — kordoc·hml-equation-parser 에는 없다).
 *
 * 분자는 예약어를 감싸는 그룹(`{…}`·`\left…\right`) 안에서 찾는다. 예전에는
 * 예약어마다 거꾸로 훑어 그 그룹을 찾고, 직전 over 의 수준을 이어 쓰는 지름길을
 * 뒀다. 그런데 직전 분수의 분모 안에 든 over 에도 그 지름길이 걸려 바깥 수준을
 * 썼고(`a over LEFT(b over c RIGHT)` → `\left.\frac{(b}{c} \right)`), 분모를
 * 빠져나온 바깥 over 는 맨 앞까지 다시 훑어 반복 수의 제곱으로 느려졌다.
 *
 * 그래서 앞으로만 움직이는 커서 하나로 열린 그룹을 쌓는다. 그룹마다 그 수준에서
 * 마지막으로 찾은 분자 탐색을 함께 두어, 안쪽 그룹을 닫고 돌아오면 바깥 수준의
 * 탐색을 그대로 이어 쓴다. 재작성은 분자 시작부터 바꾸고 분자는 짝이 맞는
 * 구조이므로, 분자 시작에서 열린 그룹은 예약어에서 열린 그룹과 같다 — 재작성
 * 뒤에는 커서를 분자 시작으로 되돌리면 되고, 새 분수의 중괄호 짝은 미리 알려
 * 두었으니(rewrite-fractions.ts) 분자를 다시 훑지 않고 건너뛴다.
 */
import { spendSteps } from "./budget.js";
import { type NumeratorWalk, shiftWalk } from "./numerator.js";
import { MEMO_KIND, recall } from "./token-memo.js";
import { type EqToken, isClose, isOpen, isValue } from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;

/** 열린 그룹 한 겹 */
export interface Level {
  /** 그룹 안쪽의 시작 — `\left` 는 구분자 뒤, 스크립트 전체는 0 */
  readonly inside: number;
  /** 이 수준에서 직전 over 의 분자 탐색 (아직 없으면 null) */
  readonly walk: NumeratorWalk | null;
}

export interface LevelCursor {
  /** 여기까지 훑었다 */
  readonly at: number;
  /** 열린 그룹들 — 바깥부터. 첫 칸은 스크립트 전체라 닫히지 않는다 */
  readonly levels: ReadonlyArray<Level>;
}

export const START_CURSOR: LevelCursor = {
  at: 0,
  levels: [{ inside: 0, walk: null }],
};

function isLeft(token: EqToken | undefined): boolean {
  return isValue(token, "\\left");
}

function isRight(token: EqToken | undefined): boolean {
  return isValue(token, "\\right");
}

/**
 * 짝을 이미 아는 중괄호 그룹의 끝(배타). 모르면 undefined — 새 분수의 중괄호는
 * 재작성이 미리 알려 두므로(rewrite-fractions.ts) 되돌아온 커서가 분자·분모를
 * 다시 훑지 않는다.
 */
function knownBraceEnd(tokens: Tokens, open: number): number | undefined {
  if (!isOpen(tokens[open])) return undefined;
  const close = recall(tokens, MEMO_KIND.brace, open);
  return close !== undefined && close > open ? close + 1 : undefined;
}

/**
 * 한 걸음 — 다음 위치. 그룹을 열면 쌓고 닫으면 내린다. `target` 앞에서 닫히는
 * 것을 이미 아는 그룹은 통째로 건너뛴다. `\left`·`\right` 뒤의 구분자는 그룹
 * 안팎의 경계라 함께 넘는다 (balanceLeftRight 가 구분자를 늘 붙여 둔다).
 */
function step(
  tokens: Tokens,
  index: number,
  target: number,
  levels: Array<Level>,
): number {
  const token = tokens[index];
  if (isOpen(token) || isLeft(token)) {
    const skipped = knownBraceEnd(tokens, index);
    if (skipped !== undefined && skipped <= target) return skipped;
    const inside = isLeft(token) ? index + 2 : index + 1;
    levels.push({ inside, walk: null });
    return inside;
  }
  if (isClose(token) || isRight(token)) {
    if (levels.length > 1) levels.pop();
    return isRight(token) ? index + 2 : index + 1;
  }
  return index + 1;
}

/** 커서를 `target`(예약어)까지 옮긴다 — 그때 열린 그룹들이 남는다 */
export function advanceTo(
  tokens: Tokens,
  cursor: LevelCursor,
  target: number,
): LevelCursor {
  const levels = [...cursor.levels];
  let i = cursor.at;
  while (i < target) {
    spendSteps(1);
    i = step(tokens, i, target, levels);
  }
  return { at: i, levels };
}

/** 예약어를 감싸는 맨 안쪽 그룹 */
export function innermost(cursor: LevelCursor): Level {
  return cursor.levels.at(-1) ?? { inside: 0, walk: null };
}

/**
 * 재작성이 분자 시작(`walk.start`)부터 길이를 `delta` 만큼 바꿨다. 맨 안쪽
 * 수준에 새 탐색을 두고 커서를 분자 시작으로 되돌린다. 바깥 수준의 탐색은 이
 * 분수 뒤에서 끝나는 단위(그 수준의 over 를 품은 괄호 등)의 끝만 민다.
 */
export function afterFraction(
  cursor: LevelCursor,
  walk: NumeratorWalk,
  delta: number,
): LevelCursor {
  spendSteps(cursor.levels.length);
  const start = walk.start;
  const outer = cursor.levels
    .slice(0, -1)
    .map((level) =>
      level.walk === null
        ? level
        : { inside: level.inside, walk: shiftWalk(level.walk, start, delta) },
    );
  const current = { ...innermost(cursor), walk: shiftWalk(walk, start, delta) };
  return { at: start, levels: [...outer, current] };
}
