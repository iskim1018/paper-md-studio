/**
 * 한컴 수식 스크립트 렉서.
 *
 * kordoc 4.7.2 `src/hwpx/equation.ts` (MIT, Copyright (c) 2026 chrisryugj) 와
 * 그 원본 hml-equation-parser `hulkEqParser.py` (Apache-2.0, Copyright 2018
 * Open Bapul) 는 `{ } &` 주변에 공백을 넣고 공백으로 잘랐다.
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)): 정규식 렉서로 바꿨다.
 * - `alpha+beta` 처럼 붙여 쓴 예약어도 연산자에서 갈라 치환되게 한다.
 * - `"…"` 리터럴을 공백이 있어도 한 덩어리로 읽는다 (닫는 따옴표가 없으면 끝까지).
 * - 한글 구절을 리터럴로 읽어 `\text{}` 로 보낸다 (수식 모드의 한글은 기울고
 *   KaTeX 가 경고한다).
 * - 각 토큰에 "앞에 공백이 있었는가"를 남겨, 한컴처럼 붙어 있는 글자를
 *   한 항으로 묶을 수 있게 한다 (`x^2n`, `a over bc`).
 * - 한컴 수식 언어에는 백슬래시 명령이 없다. `\` 는 글자 하나로 읽고
 *   map-tokens.ts 가 `\backslash` 로 바꾼다 — 사용자가 친 `\foo`·`\(` 가
 *   정의되지 않은 LaTeX 명령으로 새어 나가 수식 전체를 깨뜨리지 않게 한다.
 */
import { type EqToken, makeToken } from "./tokens.js";

const HANGUL = "\\u1100-\\u11ff\\u3130-\\u318f\\uac00-\\ud7af";

const LEXEME = new RegExp(
  [
    "(?<space>[\\s`]+)",
    '(?<quote>"[^"]*"?)',
    `(?<hangul>[${HANGUL}]+(?:[ \\t]+[${HANGUL}]+)*)`,
    "(?<operator><->|<<<|>>>|->|<<|>>|<=|>=|!=|==|\\+-|-\\+|\\/\\/)",
    `(?<word>(?:(?![${HANGUL}])\\p{L})(?:(?![${HANGUL}])[\\p{L}\\p{N}])*)`,
    "(?<number>[0-9]+(?:\\.[0-9]+)?)",
    "(?<other>[\\s\\S])",
  ].join("|"),
  "gu",
);

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * 호출측이 XML 텍스트를 덜 풀어 넘긴 경우(`&amp;`)를 한 번만 푼다.
 * 한 번의 정규식 치환이라 `&amp;lt;` 가 `<` 로 이중 해석되지 않는다.
 */
export function decodeXmlEntities(script: string): string {
  return script.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (entity, name: string) => XML_ENTITIES[name] ?? entity,
  );
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ");
}

function quoteToken(raw: string, gap: boolean): EqToken | null {
  const inner = raw.slice(
    1,
    raw.endsWith('"') && raw.length > 1 ? -1 : undefined,
  );
  if (inner.length === 0) return null;
  return makeToken(collapseSpaces(inner), "literal", gap);
}

function toToken(
  groups: Readonly<Record<string, string | undefined>>,
  raw: string,
  gap: boolean,
): EqToken | null {
  if (groups.quote !== undefined) return quoteToken(raw, gap);
  if (groups.hangul !== undefined) {
    return makeToken(collapseSpaces(raw), "literal", gap);
  }
  if (groups.word !== undefined || groups.number !== undefined) {
    return makeToken(raw, "atom", gap);
  }
  if (raw === "~") return makeToken("\\;", "symbol", gap);
  return makeToken(raw, "symbol", gap);
}

/** 스크립트를 토큰으로 자른다. 공백·역따옴표는 토큰이 아니라 `gap` 으로 남는다 */
export function lex(script: string): Array<EqToken> {
  const tokens: Array<EqToken> = [];
  let gap = true;
  for (const match of script.matchAll(LEXEME)) {
    const groups = match.groups ?? {};
    const raw = match[0];
    if (groups.space !== undefined) {
      gap = true;
      continue;
    }
    const token = toToken(groups, raw, gap);
    if (token !== null) tokens.push(token);
    // `~` 는 한컴의 공백 — 뒤 토큰과 붙지 않는다
    gap = raw === "~";
  }
  return tokens;
}
