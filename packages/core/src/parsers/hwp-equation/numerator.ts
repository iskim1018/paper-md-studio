/**
 * over·atop 의 분자 시작 찾기.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 replaceFrac 이 고친 "인접 분자"
 * 규칙(MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 hml-equation-parser
 * `hulkReplaceMethod.py` 의 replaceFrac (Apache-2.0, Copyright 2018 Open Bapul).
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - 분자는 같은 그룹(또는 `\left…\right`) 안에서 over 바로 앞 항이다. 그 수준을
 *   앞에서부터 항 단위로 나눠 over 직전에 끝나는 단위를 고른다.
 * - over 를 품은 맨 괄호 `(…)`·`[…]` 는 그 안으로 들어가 다시 나눈다 —
 *   `(1+ 1 over n)` 의 분자는 `1` 이다. 예전에는 괄호 항이 over 를 넘어 분자가
 *   비었고(`(1+ 1 \frac{}{n})`), 출력이 유효한 LaTeX 라 경고도 없었다.
 * - 같은 수준의 직전 over 탐색을 이어 쓴다. 재작성은 분자 시작 앞을 바꾸지
 *   않으므로, 같은 수준의 다음 over 는 처음부터 다시 나눌 필요가 없다 — over
 *   마다 수준 전체를 다시 훑으면 over 가 많은 스크립트에서 O(n²) 이 된다.
 *   수준(감싸는 그룹)과 수준별 직전 탐색은 levels.ts 가 들고 있다.
 */
import { spendSteps } from "./budget.js";
import {
  atomEnd,
  isScriptOp,
  operandEnd,
  scriptChainEnd,
  startsItem,
} from "./items.js";
import { isSizer } from "./left-right.js";
import type { EqToken } from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;

/** 분자를 찾다가 들어간 단위 한 겹 — over 를 넘던 괄호·명령 항 */
interface Straddle {
  /** 단위의 시작 — 바깥 수준의 단위 경계 */
  readonly start: number;
  /** 단위의 끝(배타) — 그때의 over 보다 뒤 */
  readonly end: number;
}

/** 분자 탐색 결과. 같은 수준의 다음 over 가 이어 쓸 수 있게 탐색 경로를 남긴다 */
export interface NumeratorWalk {
  /** 들어간 단위들 (바깥부터) */
  readonly straddles: ReadonlyArray<Straddle>;
  /** 분자 시작 — 단위 경계다 */
  readonly start: number;
}

/**
 * 이 위치에서 시작하는 분할 단위의 끝 — 분수 피연산자(항과 그 뒤 계승 `!`),
 * 밑 없는 첨자 사슬, 또는 토큰 하나
 */
function unitEnd(tokens: Tokens, index: number): number {
  if (startsItem(tokens, index)) return operandEnd(tokens, index);
  if (isScriptOp(tokens[index])) return scriptChainEnd(tokens, index);
  return index + 1;
}

/**
 * over 를 넘어가는 단위 안으로 들어갈 자리. 붙은 원자 중 over 를 품은 것으로
 * 가고, 그 원자가 단위의 첫 원자면 그 안으로 (괄호 `(`·`[` 의 안쪽,
 * `\sqrt [ … ]` 의 지수 괄호). 늘 `start` 보다 뒤라 탐색이 끝난다.
 *
 * `\left` 는 구분자 뒤로 들어간다 — 구분자를 분자로 떼어 가면 짝이 깨져
 * `\left.\frac{(b}{c} \right)` 가 된다. `\left…\right` 는 수준이라 levels.ts 가
 * 맞게 잡으면 여기 오지 않지만, 어긋나도 구분자는 지킨다.
 */
function stepInside(tokens: Tokens, start: number, keyword: number): number {
  let atom = start;
  for (let end = atomEnd(tokens, atom); end <= keyword && end > atom; ) {
    atom = end;
    end = atomEnd(tokens, atom);
  }
  if (atom > start) return atom;
  return isSizer(tokens[start]) ? start + 2 : start + 1;
}

interface WalkPoint {
  readonly from: number;
  readonly straddles: ReadonlyArray<Straddle>;
}

/** 직전 탐색에서 이어 갈 자리 — 아직 over 를 품은 단위까지만 남긴다 */
function resumeFrom(previous: NumeratorWalk, keyword: number): WalkPoint {
  const passed = previous.straddles.findIndex((unit) => unit.end <= keyword);
  const left = previous.straddles[passed];
  if (left === undefined) {
    return { from: previous.start, straddles: previous.straddles };
  }
  return { from: left.start, straddles: previous.straddles.slice(0, passed) };
}

/**
 * 같은 수준을 `from` 부터 단위로 나눠 over 직전에 끝나는 단위를 고른다.
 * 그 단위가 항이 아니면(`= over 2`) 빈 분자. 밑 없는 첨자(`= _{a} over b`)는
 * 첨자째 분자가 된다 — 첨자 인자 그룹만 떼어 가면 `_\frac{…}` 처럼 인자 없는
 * 첨자가 남는다. 단위가 over 를 넘어가면 그 안으로 들어가 다시 나눈다.
 */
function walkUnits(
  tokens: Tokens,
  keyword: number,
  point: WalkPoint,
): NumeratorWalk {
  const straddles = [...point.straddles];
  let i = point.from;
  while (i < keyword) {
    spendSteps(1);
    const end = unitEnd(tokens, i);
    if (end > keyword) {
      straddles.push({ start: i, end });
      i = stepInside(tokens, i, keyword);
      continue;
    }
    if (end === keyword) {
      const isItem = end - i > 1 || startsItem(tokens, i);
      return { start: isItem ? i : keyword, straddles };
    }
    i = end;
  }
  return { start: keyword, straddles };
}

/**
 * over(`keyword`) 바로 앞 항의 시작. `inside` 는 over 를 감싸는 그룹 안쪽의
 * 시작, `previous` 는 같은 그룹에서 직전 over 의 탐색이다 (levels.ts) — 재작성
 * 으로 밀린 위치는 shiftWalk 로 맞춰 넘긴다.
 */
export function findNumerator(
  tokens: Tokens,
  keyword: number,
  inside: number,
  previous: NumeratorWalk | null,
): NumeratorWalk {
  const point =
    previous === null
      ? { from: inside, straddles: [] }
      : resumeFrom(previous, keyword);
  return walkUnits(tokens, keyword, point);
}

/**
 * 재작성이 `from` 부터 길이를 `delta` 만큼 바꿨다. 그 뒤에서 끝나는 단위의
 * 끝을 민다 — 이 수준의 over 를 품은 단위는 분수 뒤에서 끝나고, 앞서 끝난
 * 단위는 그대로다. 바뀔 것이 없으면 같은 객체를 돌려준다.
 */
export function shiftWalk(
  walk: NumeratorWalk,
  from: number,
  delta: number,
): NumeratorWalk {
  const moves = (unit: Straddle): boolean => unit.end > from;
  if (delta === 0 || !walk.straddles.some(moves)) return walk;
  return {
    start: walk.start,
    straddles: walk.straddles.map((unit) =>
      moves(unit) ? { start: unit.start, end: unit.end + delta } : unit,
    ),
  };
}
