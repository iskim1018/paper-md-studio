/**
 * 단일 토큰 치환 — 예약어·기호를 LaTeX 조각이나 내부 표식으로 바꾼다.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 hmlToLatex 토큰 루프와
 * replaceBracket (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은
 * hml-equation-parser `hulkEqParser.py` (Apache-2.0, Copyright 2018 Open Bapul).
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - `\left {` 를 `\left \{` 대신 `\left\lbrace` 로 — 이스케이프된 중괄호가
 *   그룹 괄호 짝 찾기를 어지럽히지 않는다.
 * - LaTeX 에서 의미가 다른 문자를 막는다: `%`(주석 시작) → `\%`,
 *   `$`(인라인 수식 종료) → `\text{\textdollar}`, `|`(GFM 표 셀 구분) → `\vert`,
 *   `\`(한컴에는 명령 접두사가 아니다) → `\backslash`.
 * - 붙여 쓴 연산자 기호가 명령이 되면 앞뒤를 띄운다 (`a<=b` → `a \leq b`).
 */
import { lookup } from "./convert-map.js";
import { resolveOperator, resolveWord } from "./hwp5-aliases.js";
import { type EqToken, type EqTokenKind, isValue } from "./tokens.js";

const SYMBOL_FIXES: Readonly<Record<string, string>> = {
  "%": "\\%",
  $: "\\text{\\textdollar}",
  "|": "\\vert",
  "\\": "\\backslash",
};

/** 구조 패스가 값으로 알아보는 토큰 — 항을 끊는 기호로 취급한다 */
const STRUCTURAL_VALUES: ReadonlySet<string> = new Set([
  "{",
  "}",
  "#",
  "&",
  "^",
  "_",
  "'",
  "over",
  "atop",
  "of",
]);

function mapValue(token: EqToken): string {
  if (token.kind === "atom" && /^\p{L}/u.test(token.value)) {
    return resolveWord(token.value);
  }
  return lookup(SYMBOL_FIXES, token.value) ?? resolveOperator(token.value);
}

function kindOf(token: EqToken, value: string): EqTokenKind {
  return STRUCTURAL_VALUES.has(value) ? "symbol" : token.kind;
}

/** 기호가 명령으로 바뀌었는가 (`<=` → `\leq`) — 앞뒤를 띄운다 */
function becameCommand(token: EqToken, value: string): boolean {
  return token.kind === "symbol" && value.startsWith("\\");
}

/** `\left {`·`\right }` 의 중괄호는 그룹이 아니라 구분자다 */
function asSizerDelimiter(
  previous: EqToken | undefined,
  token: EqToken,
): EqToken {
  const afterSizer =
    isValue(previous, "\\left") || isValue(previous, "\\right");
  if (!afterSizer) return token;
  if (isValue(token, "{")) return { ...token, value: "\\lbrace" };
  if (isValue(token, "}")) return { ...token, value: "\\rbrace" };
  return token;
}

export function mapTokens(tokens: ReadonlyArray<EqToken>): Array<EqToken> {
  const mapped: Array<EqToken> = [];
  let forceGap = false;
  for (const token of tokens) {
    if (token.kind === "literal") {
      mapped.push(forceGap ? { ...token, gap: true } : token);
      forceGap = false;
      continue;
    }
    const value = mapValue(token);
    if (value === "") {
      // 버린 토큰(rm, it, UNDEROVER) 자리는 공백으로 남긴다
      forceGap = true;
      continue;
    }
    const spaced = becameCommand(token, value);
    const next: EqToken = {
      value,
      kind: kindOf(token, value),
      gap: token.gap || forceGap || spaced,
    };
    mapped.push(asSizerDelimiter(mapped.at(-1), next));
    forceGap = spaced;
  }
  return mapped;
}
