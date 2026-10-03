/**
 * over·atop 의 분자 시작 찾기.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 replaceFrac 이 고친 "인접 분자"
 * 규칙(MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 hml-equation-parser
 * `hulkReplaceMethod.py` 의 replaceFrac (Apache-2.0, Copyright 2018 Open Bapul).
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - 분자는 같은 그룹(또는 `\left…\right`) 안에서 over 바로 앞 항이다. 그 수준을
 *   앞에서부터 항 단위로 나눠 over 직전에 끝나는 단위를 고른다.
 * - over 를 품은 맨 괄호 `(…)`·`[…]` 는 그 안으로 들어가 다시 나눈다 —
 *   `(1+ 1 over n)` 의 분자는 `1` 이다. 예전에는 괄호 항이 over 를 넘어 분자가
 *   비었고(`(1+ 1 \frac{}{n})`), 출력이 유효한 LaTeX 라 경고도 없었다.
 * - 직전 over 의 탐색을 이어 쓴다. 재작성은 분자 시작 앞을 바꾸지 않으므로,
 *   같은 수준의 다음 over 는 처음부터 다시 나눌 필요가 없다 — over 마다 수준
 *   전체를 다시 훑으면 over 가 많은 스크립트에서 O(n²) 이 된다.
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
import { type EqToken, isClose, isOpen, isValue } from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;

/** 분자를 찾다가 들어간 단위 한 겹 — over 를 넘던 괄호·명령 항 */
interface Straddle {
  /** 단위의 시작 — 바깥 수준의 단위 경계 */
  readonly start: number;
  /** 단위의 끝(배타) — 그때의 over 보다 뒤 */
  readonly end: number;
}

/** 분자 탐색 결과. 다음 over 가 이어 쓸 수 있게 탐색 경로를 함께 남긴다 */
export interface NumeratorWalk {
  /** over 를 감싸는 그룹 안쪽의 시작 */
  readonly level: number;
  /** 들어간 단위들 (바깥부터) */
  readonly straddles: ReadonlyArray<Straddle>;
  /** 분자 시작 — 단위 경계다 */
  readonly start: number;
}

/** 재작성을 마친 직전 탐색 — 위치는 새 배열 기준이다 */
export interface WalkResume extends NumeratorWalk {
  /** 새로 만든 분수의 끝(배타) — `[start, fractionEnd)` 는 짝이 맞는 구조뿐이다 */
  readonly fractionEnd: number;
}

/** 거꾸로 훑은 결과 — 감싸는 그룹 안쪽의 시작(못 찾으면 null)과 남은 깊이 */
interface BackScan {
  readonly inside: number | null;
  readonly depth: number;
}

/** `[floor, from)` 을 거꾸로 훑어 짝 없는 여는 토큰(`{`·`\left`)을 찾는다 */
function scanBack(
  tokens: Tokens,
  from: number,
  floor: number,
  startDepth: number,
): BackScan {
  let depth = startDepth;
  for (let i = from - 1; i >= floor; i -= 1) {
    spendSteps(1);
    const token = tokens[i];
    if (isClose(token) || isValue(token, "\\right")) depth += 1;
    else if (isOpen(token) || isValue(token, "\\left")) {
      if (depth === 0) return { inside: isSizer(token) ? i + 2 : i + 1, depth };
      depth -= 1;
    }
  }
  return { inside: null, depth };
}

/**
 * `index` 를 감싸는 그룹(또는 `\left…\right`) 안쪽의 시작. 직전 분수의 끝까지
 * 짝이 맞으면 그 분수와 같은 수준이므로 더 훑지 않는다 (분수 안은 짝이 맞는
 * 구조뿐이다).
 */
function enclosingStart(
  tokens: Tokens,
  index: number,
  previous: WalkResume | null,
): number {
  const floor = Math.min(previous?.fractionEnd ?? 0, index);
  const near = scanBack(tokens, index, floor, 0);
  if (near.inside !== null) return near.inside;
  if (previous !== null && near.depth === 0) return previous.level;
  return scanBack(tokens, floor, 0, near.depth).inside ?? 0;
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
 * 가고, 그 원자가 단위의 첫 원자면 한 칸 안으로 (괄호 `(`·`[` 의 안쪽,
 * `\sqrt [ … ]` 의 지수 괄호). 늘 `start` 보다 뒤라 탐색이 끝난다.
 */
function stepInside(tokens: Tokens, start: number, keyword: number): number {
  let atom = start;
  for (let end = atomEnd(tokens, atom); end <= keyword && end > atom; ) {
    atom = end;
    end = atomEnd(tokens, atom);
  }
  return atom > start ? atom : start + 1;
}

interface WalkPoint {
  readonly from: number;
  readonly straddles: ReadonlyArray<Straddle>;
}

/** 직전 탐색에서 이어 갈 자리 — 아직 over 를 품은 단위까지만 남긴다 */
function resumeFrom(previous: WalkResume, keyword: number): WalkPoint {
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
): Pick<NumeratorWalk, "start" | "straddles"> {
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
 * over(`keyword`) 바로 앞 항의 시작. `previous` 는 같은 패스에서 직전 over 의
 * 탐색이다 — 재작성으로 밀린 위치는 shiftWalk 로 맞춰 넘긴다.
 */
export function findNumerator(
  tokens: Tokens,
  keyword: number,
  previous: WalkResume | null,
): NumeratorWalk {
  const level = enclosingStart(tokens, keyword, previous);
  const point =
    previous !== null && previous.level === level
      ? resumeFrom(previous, keyword)
      : { from: level, straddles: [] };
  return { level, ...walkUnits(tokens, keyword, point) };
}

/**
 * 재작성이 `[start, end)` 를 길이 `fractionLength` 의 분수로 바꿨다. 분수 뒤는
 * 밀렸으므로 들어간 단위들의 끝(늘 분수 뒤)도 함께 민다.
 */
export function afterRewrite(
  walk: NumeratorWalk,
  delta: number,
  fractionLength: number,
): WalkResume {
  return {
    ...walk,
    straddles: walk.straddles.map((unit) => ({
      start: unit.start,
      end: unit.end + delta,
    })),
    fractionEnd: walk.start + fractionLength,
  };
}
