/**
 * "항" 읽기 — over·root·첨자·장식이 적용될 범위를 정한다.
 *
 * kordoc 4.7.2 `src/hwpx/equation.ts` (MIT, Copyright (c) 2026 chrisryugj) 와
 * 원본 hml-equation-parser (Apache-2.0, Copyright 2018 Open Bapul) 는 인자를
 * "가장 가까운 `{…}` 그룹"으로만 찾아서, 괄호 없는 인자(`a over bc`,
 * `1 over sqrt {x}`)는 분모가 한 글자로 잘리거나 엉뚱한 그룹을 집었다.
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)): 한컴 편집기의 묶음 규칙에 맞춰 항을 정의한다.
 * - 원자: `{…}` 그룹, `\left…\right`, `(…)`·`[…]`, 인자를 받는 명령+인자,
 *   `root … of …`, 단어·숫자·명령·리터럴 하나.
 * - 공백 없이 붙은 원자(단어·숫자·괄호)는 한 항이다: `2x`, `n(n-1)x`, `f(x)`.
 *   연산자 기호와 `{…}` 그룹은 항을 끊는다: `y=a over b` 의 분자는 `a`.
 * - 항 뒤의 `^`·`_` 첨자 사슬은 그 항에 속한다: `x^2 over 3` 의 분자는 `x^2`.
 * - 프라임만 붙은 사슬 뒤에 공백 없이 이어지는 원자도 같은 항이다: `f'(x)`.
 * - 분수의 분자·분모에서는 항 뒤의 계승 `!` 도 그 항에 속한다: `n!`, `(n+1)!`.
 * - 모든 끝 위치를 (토큰 배열, 종류, 위치) 로 메모하고, 괄호 짝은 안쪽 괄호의
 *   결과로 건너뛰며 찾는다 — 한 패스의 항 읽기 전체가 토큰 수에 비례한다.
 *   예전에는 짝 없는 괄호마다 끝까지 훑고 같은 꼬리를 거듭 읽어 O(n³) 이었다.
 */
import { descend, spendSteps } from "./budget.js";
import { arityOf } from "./keyword-maps.js";
import { findMatchingRight } from "./left-right.js";
import { MEMO_KIND as MEMO, recall, remember } from "./token-memo.js";
import { type EqToken, findClose, isOpen, isValue } from "./tokens.js";

const BRACKET_PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]" };

type Tokens = ReadonlyArray<EqToken>;
type EndFinder = (tokens: Tokens, index: number) => number;

/** (배열, 종류, 위치) 로 메모한 끝 위치 — 처음 한 번만 `find` 로 계산한다 */
function memoized(
  tokens: Tokens,
  kind: number,
  index: number,
  find: EndFinder,
): number {
  const known = recall(tokens, kind, index);
  if (known !== undefined) return known;
  spendSteps(1);
  return remember(tokens, kind, index, find(tokens, index));
}

export function isScriptOp(token: EqToken | undefined): boolean {
  return isValue(token, "^") || isValue(token, "_");
}

function isSign(token: EqToken | undefined): boolean {
  return isValue(token, "-") || isValue(token, "+") || isValue(token, "\\pm");
}

function takesArguments(token: EqToken): boolean {
  return (
    token.kind !== "literal" &&
    (arityOf(token.value) > 0 || token.value === "root")
  );
}

function opensGroup(token: EqToken): boolean {
  return (
    isOpen(token) ||
    isValue(token, "(") ||
    isValue(token, "[") ||
    isValue(token, "\\left")
  );
}

/** 이 위치에서 항이 시작될 수 있는가 */
export function startsItem(tokens: Tokens, index: number): boolean {
  const token = tokens[index];
  if (token === undefined) return false;
  if (token.kind === "literal" || takesArguments(token)) return true;
  if (isValue(token, "\\right")) return false;
  return token.kind === "atom" || opensGroup(token);
}

/** 공백 없이 이웃과 한 항으로 붙을 수 있는 원자인가 (그룹·명령+인자는 제외) */
function isJoinable(token: EqToken | undefined): boolean {
  if (token === undefined || isOpen(token)) return false;
  if (token.kind === "literal" || opensGroup(token)) return true;
  return (
    token.kind === "atom" &&
    !takesArguments(token) &&
    !isValue(token, "\\right")
  );
}

/** 이 자리에 공백 없이 붙은 결합 가능 원자가 있는가 */
function joinsAt(tokens: Tokens, index: number): boolean {
  const token = tokens[index];
  return token !== undefined && !token.gap && isJoinable(token);
}

/** `\left` 에서 짝인 `\right` 의 구분자 뒤 */
function sizedGroupEnd(tokens: Tokens, left: number): number {
  const right = findMatchingRight(tokens, left);
  return right < 0 ? left + 1 : Math.min(right + 2, tokens.length);
}

/** 괄호 항이 넘으면 안 되는 경계 — 감싸면 LaTeX 구조가 깨진다 */
function isBoundary(token: EqToken | undefined): boolean {
  return (
    isValue(token, "}") ||
    isValue(token, "\\right") ||
    isValue(token, "&") ||
    isValue(token, "#")
  );
}

/** 괄호 탐색에서 그룹(`{…}`·`\left…\right`)을 통째로 건너뛴 다음 위치. 아니면 -1 */
function skipGroup(tokens: Tokens, index: number): number {
  const token = tokens[index];
  if (isOpen(token)) return Math.max(findClose(tokens, index), index) + 1;
  if (isValue(token, "\\left")) return sizedGroupEnd(tokens, index);
  return -1;
}

/** 같은 종류 괄호들을 한 번에 푸는 탐색 — 결과가 아직 없는 여는 괄호를 쌓는다 */
interface BracketScan {
  readonly tokens: Tokens;
  readonly opener: string;
  readonly closer: string;
  readonly pending: Array<number>;
}

/** 탐색 결과 신호 — 남은 괄호가 모두 짝이 없다 / 맨 바깥 괄호가 닫혔다 */
const SCAN_UNMATCHED = -1;
const SCAN_CLOSED = -2;

/** 안쪽의 같은 종류 여는 괄호 — 결과가 있으면 건너뛰고, 없으면 쌓는다 */
function enterBracket(scan: BracketScan, index: number): number {
  const inner = recall(scan.tokens, MEMO.bracket, index);
  // 안쪽이 짝이 없으면 바깥도 같은 경계·끝에 닿으므로 짝이 없다
  if (inner === index + 1) return SCAN_UNMATCHED;
  if (inner !== undefined) return inner;
  scan.pending.push(index);
  return index + 1;
}

/** 탐색 한 걸음 — 다음 위치, 또는 SCAN_UNMATCHED·SCAN_CLOSED */
function scanBracketAt(scan: BracketScan, index: number): number {
  const token = scan.tokens[index];
  const skipped = skipGroup(scan.tokens, index);
  if (skipped >= 0) return skipped;
  if (isBoundary(token)) return SCAN_UNMATCHED;
  if (isValue(token, scan.opener)) return enterBracket(scan, index);
  if (isValue(token, scan.closer)) {
    const matched = scan.pending.pop() ?? index;
    remember(scan.tokens, MEMO.bracket, matched, index + 1);
    if (scan.pending.length === 0) return SCAN_CLOSED;
  }
  return index + 1;
}

/**
 * `(`·`[` 에서 같은 종류의 짝 괄호 뒤. 그룹·`\right`·`&`·`#` 경계를 넘거나
 * 짝이 없으면 괄호 하나 (LaTeX 에서 짝 없는 소괄호는 문제없다).
 *
 * 안쪽의 같은 종류 괄호는 그 결과로 건너뛰고, 결과가 아직 없는 안쪽 괄호는
 * 쌓아 한 번의 훑기로 함께 푼다 — 같은 종류 괄호들의 탐색이 겹치지 않는다.
 */
function bracketEnd(tokens: Tokens, open: number): number {
  const known = recall(tokens, MEMO.bracket, open);
  if (known !== undefined) return known;
  const opener = tokens[open]?.value ?? "";
  const closer = BRACKET_PAIRS[opener] ?? "";
  const scan: BracketScan = { tokens, opener, closer, pending: [open] };
  let i = open + 1;
  while (i >= 0 && i < tokens.length) {
    spendSteps(1);
    i = scanBracketAt(scan, i);
  }
  if (i === SCAN_CLOSED) return recall(tokens, MEMO.bracket, open) ?? open + 1;
  // 경계나 끝에 닿았다 — 남은 괄호는 모두 괄호 하나
  for (const unmatched of scan.pending) {
    remember(tokens, MEMO.bracket, unmatched, unmatched + 1);
  }
  return open + 1;
}

/** `root A of B` 전체의 끝. `of` 가 없으면 `root A` 까지 */
function rootEnd(tokens: Tokens, root: number): number {
  const indexEnd = argumentEnd(tokens, root + 1);
  if (!isValue(tokens[indexEnd], "of")) return indexEnd;
  return argumentEnd(tokens, indexEnd + 1);
}

/** 인자를 받는 명령과 그 인자들의 끝 */
function commandEnd(tokens: Tokens, index: number, value: string): number {
  let end = index + 1;
  // root 가 만든 `\sqrt [ 지수 ] { 밑 }` 의 지수
  if (value === "\\sqrt" && isValue(tokens[end], "[")) {
    end = bracketEnd(tokens, end);
  }
  for (let k = 0; k < arityOf(value); k += 1) {
    end = argumentEnd(tokens, end);
  }
  return end;
}

function findAtomEnd(tokens: Tokens, index: number): number {
  const token = tokens[index];
  if (token === undefined) return index;
  if (token.kind === "literal") return index + 1;
  if (isOpen(token)) {
    const close = findClose(tokens, index);
    return close < 0 ? index + 1 : close + 1;
  }
  if (isValue(token, "\\left")) return sizedGroupEnd(tokens, index);
  if (isValue(token, "(") || isValue(token, "[")) {
    return bracketEnd(tokens, index);
  }
  // 인자 안에 인자가 겹치는 자리만 재귀한다 — 깊이는 예산이 막는다
  if (isValue(token, "root")) return descend(() => rootEnd(tokens, index));
  if (arityOf(token.value) === 0) return index + 1;
  return descend(() => commandEnd(tokens, index, token.value));
}

/** 원자 하나의 끝(배타) — 인접 결합·첨자는 포함하지 않는다 */
export function atomEnd(tokens: Tokens, index: number): number {
  return memoized(tokens, MEMO.atom, index, findAtomEnd);
}

/**
 * `from` 부터 공백 없이 이어 붙은 원자들의 끝. 거쳐 간 원자에서 시작하는
 * 항도 같은 곳에서 끝나므로 함께 메모한다 (`2(3)(4)…` 를 한 번만 훑는다).
 */
function joinedRunEnd(tokens: Tokens, from: number): number {
  const passed: Array<number> = [];
  let end = from;
  while (joinsAt(tokens, end)) {
    spendSteps(1);
    const known = recall(tokens, MEMO.joined, end);
    if (known !== undefined) {
      end = known;
      break;
    }
    passed.push(end);
    end = atomEnd(tokens, end);
  }
  for (const start of passed) remember(tokens, MEMO.joined, start, end);
  return end;
}

/** 첨자를 뺀 항의 끝 — 공백 없이 붙은 원자까지 */
function findJoinedEnd(tokens: Tokens, index: number): number {
  if (!startsItem(tokens, index)) return index;
  const end = atomEnd(tokens, index);
  return isJoinable(tokens[index]) ? joinedRunEnd(tokens, end) : end;
}

/** 첨자 사슬의 다음 고리 위치 — 사슬이 끝났으면 `at` 그대로 */
function nextChainLink(tokens: Tokens, at: number): number {
  const op = tokens[at];
  if (isValue(op, "'")) return at + 1;
  if (op !== undefined && isScriptOp(op)) {
    return scriptArgumentEnd(tokens, at + 1, op.value);
  }
  return at;
}

/**
 * 첨자 사슬(`^ 항`, `_ 항`, 프라임 `'` 의 반복)의 끝. 사슬 중간의 고리에서
 * 시작해도 같은 곳에서 끝나므로 거쳐 간 자리를 함께 메모한다.
 */
export function scriptChainEnd(tokens: Tokens, from: number): number {
  const passed: Array<number> = [];
  let end = from;
  for (;;) {
    spendSteps(1);
    const known = recall(tokens, MEMO.chain, end);
    if (known !== undefined) {
      end = known;
      break;
    }
    passed.push(end);
    const next = nextChainLink(tokens, end);
    if (next === end) break;
    end = next;
  }
  for (const start of passed) remember(tokens, MEMO.chain, start, end);
  return end;
}

/** `[from, to)` 가 프라임 `'` 만으로 된 사슬인가 (`f'`, `f''`) */
function isPrimeRun(tokens: Tokens, from: number, to: number): boolean {
  if (to <= from) return false;
  return tokens.slice(from, to).every((token) => isValue(token, "'"));
}

/**
 * 첨자 사슬까지 포함한 항의 끝. 밑이 붙여 쓰는 원자(`f`, `g`)면 프라임만 붙은
 * 사슬 뒤에 공백 없이 이어지는 원자도 같은 항이다 (`f'(x)`, `f''(x)`). 밑이
 * 그룹이면(`{f}'(x)`) 잇지 않는다 — 그룹은 원래 이웃과 붙지 않는다.
 */
function findItemEnd(tokens: Tokens, index: number): number {
  let end = itemEnd(tokens, index, false);
  if (end === index) return index;
  const joinsAfterPrime = isJoinable(tokens[index]);
  for (;;) {
    spendSteps(1);
    const chained = scriptChainEnd(tokens, end);
    const primeJoin =
      joinsAfterPrime &&
      isPrimeRun(tokens, end, chained) &&
      joinsAt(tokens, chained);
    if (!primeJoin) return chained;
    end = itemEnd(tokens, chained, false);
  }
}

/**
 * 항의 끝(배타). 공백 없이 붙은 원자를 잇고, withScripts 면 첨자 사슬(과
 * 프라임 뒤 결합)까지. 항이 시작될 수 없는 자리면 `index` 그대로 (빈 항).
 */
export function itemEnd(
  tokens: Tokens,
  index: number,
  withScripts: boolean,
): number {
  return withScripts
    ? memoized(tokens, MEMO.item, index, findItemEnd)
    : memoized(tokens, MEMO.joined, index, findJoinedEnd);
}

/** 명령 인자 하나의 끝 — 인자 자체의 첨자까지 포함 (`sqrt x^2` = √(x²)) */
export function argumentEnd(tokens: Tokens, index: number): number {
  return itemEnd(tokens, index, true);
}

/** 앞에 공백 없이 붙은 부호(`-x`)인가 */
function startsWithSign(tokens: Tokens, index: number): boolean {
  return (
    isSign(tokens[index]) &&
    startsItem(tokens, index + 1) &&
    tokens[index + 1]?.gap === false
  );
}

/**
 * 첨자 인자의 끝. 첨자 사슬은 바깥 항의 몫이라 포함하지 않는다(`x_1^2`).
 * 다만 같은 첨자가 겹치면(`x^a^b`) 안쪽으로 넣어 이중 첨자 오류를 피하고,
 * 부호가 붙은 항(`e^-x`)은 부호까지 인자로 본다. 겹친 첨자는 재귀 대신
 * 반복으로 따라가고, 거쳐 간 자리를 함께 메모한다.
 */
export function scriptArgumentEnd(
  tokens: Tokens,
  index: number,
  op: string,
): number {
  const kind = op === "_" ? MEMO.subscript : MEMO.superscript;
  const passed: Array<number> = [];
  let at = index;
  let end = index;
  for (;;) {
    spendSteps(1);
    const known = recall(tokens, kind, at);
    if (known !== undefined) {
      end = known;
      break;
    }
    passed.push(at);
    const start = startsWithSign(tokens, at) ? at + 1 : at;
    end = itemEnd(tokens, start, false);
    if (!isValue(tokens[end], op)) break;
    at = end + 1;
  }
  for (const start of passed) remember(tokens, kind, start, end);
  return end;
}

/**
 * 분수의 분자·분모가 되는 항의 끝 — 항 뒤의 계승 `!` 까지 (`n!`, `(n+1)!`,
 * `x^2!`). 명령 인자에는 붙이지 않는다: `bar{n}!` 의 `!` 는 장식 밖이다.
 */
export function operandEnd(tokens: Tokens, index: number): number {
  let end = itemEnd(tokens, index, true);
  if (end === index) return index;
  while (isValue(tokens[end], "!")) end += 1;
  return end;
}

/** 분모처럼 앞 부호를 허용하는 분수 피연산자의 끝 (`1 over -2`, `1 over n!`) */
export function signedItemEnd(tokens: Tokens, index: number): number {
  const start = startsWithSign(tokens, index) ? index + 1 : index;
  return operandEnd(tokens, start);
}
