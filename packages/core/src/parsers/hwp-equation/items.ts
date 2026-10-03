/**
 * "항" 읽기 — over·root·첨자·장식이 적용될 범위를 정한다.
 *
 * kordoc 4.7.2 `src/hwpx/equation.ts` (MIT, Copyright (c) 2026 chrisryugj) 와
 * 원본 hml-equation-parser (Apache-2.0, Copyright 2018 Open Bapul) 는 인자를
 * "가장 가까운 `{…}` 그룹"으로만 찾아서, 괄호 없는 인자(`a over bc`,
 * `1 over sqrt {x}`)는 분모가 한 글자로 잘리거나 엉뚱한 그룹을 집었다.
 *
 * 변경 사항 (Apache-2.0 §4(b)): 한컴 편집기의 묶음 규칙에 맞춰 항을 정의한다.
 * - 원자: `{…}` 그룹, `\left…\right`, `(…)`·`[…]`, 인자를 받는 명령+인자,
 *   `root … of …`, 단어·숫자·명령·리터럴 하나.
 * - 공백 없이 붙은 원자(단어·숫자·괄호)는 한 항이다: `2x`, `n(n-1)x`, `f(x)`.
 *   연산자 기호와 `{…}` 그룹은 항을 끊는다: `y=a over b` 의 분자는 `a`.
 * - 항 뒤의 `^`·`_` 첨자 사슬은 그 항에 속한다: `x^2 over 3` 의 분자는 `x^2`.
 */
import { arityOf } from "./keyword-maps.js";
import { findMatchingRight } from "./left-right.js";
import { type EqToken, findClose, isOpen, isValue } from "./tokens.js";

const BRACKET_PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]" };

type Tokens = ReadonlyArray<EqToken>;

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

/**
 * `(`·`[` 에서 같은 종류의 짝 괄호 뒤. 그룹·`\right`·`&`·`#` 경계를 넘거나
 * 짝이 없으면 괄호 하나 (LaTeX 에서 짝 없는 소괄호는 문제없다)
 */
function bracketEnd(tokens: Tokens, open: number): number {
  const opener = tokens[open]?.value ?? "";
  const closer = BRACKET_PAIRS[opener] ?? "";
  let depth = 0;
  let i = open;
  while (i < tokens.length) {
    const token = tokens[i];
    if (isOpen(token)) i = Math.max(findClose(tokens, i), i);
    else if (isValue(token, "\\left")) i = sizedGroupEnd(tokens, i) - 1;
    else if (isBoundary(token)) return open + 1;
    else if (isValue(token, opener)) depth += 1;
    else if (isValue(token, closer)) depth -= 1;
    if (depth === 0) return i + 1;
    i += 1;
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

/** 원자 하나의 끝(배타) — 인접 결합·첨자는 포함하지 않는다 */
export function atomEnd(tokens: Tokens, index: number): number {
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
  if (isValue(token, "root")) return rootEnd(tokens, index);
  return commandEnd(tokens, index, token.value);
}

/** 첨자 사슬(`^ 항`, `_ 항`, 프라임 `'` 의 반복)의 끝 */
export function scriptChainEnd(tokens: Tokens, from: number): number {
  let end = from;
  for (let op = tokens[end]; op !== undefined; op = tokens[end]) {
    if (isValue(op, "'")) end += 1;
    else if (isScriptOp(op)) end = scriptArgumentEnd(tokens, end + 1, op.value);
    else break;
  }
  return end;
}

/**
 * 항의 끝(배타). 공백 없이 붙은 원자를 잇고, withScripts 면 첨자 사슬까지.
 * 항이 시작될 수 없는 자리면 `index` 그대로 (빈 항).
 */
export function itemEnd(
  tokens: Tokens,
  index: number,
  withScripts: boolean,
): number {
  if (!startsItem(tokens, index)) return index;
  let end = atomEnd(tokens, index);
  if (isJoinable(tokens[index])) {
    while (joinsAt(tokens, end)) end = atomEnd(tokens, end);
  }
  return withScripts ? scriptChainEnd(tokens, end) : end;
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
 * 부호가 붙은 항(`e^-x`)은 부호까지 인자로 본다.
 */
export function scriptArgumentEnd(
  tokens: Tokens,
  index: number,
  op: string,
): number {
  const start = startsWithSign(tokens, index) ? index + 1 : index;
  const end = itemEnd(tokens, start, false);
  if (!isValue(tokens[end], op)) return end;
  return scriptArgumentEnd(tokens, end + 1, op);
}

/** 분모처럼 앞 부호를 허용하는 항의 끝 (`1 over -2`) */
export function signedItemEnd(tokens: Tokens, index: number): number {
  const start = startsWithSign(tokens, index) ? index + 1 : index;
  return itemEnd(tokens, start, true);
}
