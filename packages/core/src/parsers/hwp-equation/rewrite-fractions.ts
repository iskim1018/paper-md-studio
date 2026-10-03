/**
 * `root A of B` → `\sqrt[A]{B}`, `A over B` → `\frac{A}{B}`, `A atop B` → `{A \atop B}`.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 replaceFrac·replaceRootOf
 * (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 hml-equation-parser
 * `hulkReplaceMethod.py` 의 replaceFrac·replaceRootOf (Apache-2.0,
 * Copyright 2018 Open Bapul).
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - 분자·분모를 items.ts 의 항 규칙으로 정한다. 원본은 분모를 감싸지 않아
 *   `a over bc` 가 `\frac{a} bc`(= a/b · c), `1 over sqrt {x}` 가 렌더링 오류가 됐다.
 * - 분자는 같은 그룹(또는 `\left…\right`) 안에서 over 바로 앞 항만 — kordoc 의
 *   "인접 분자" 수정(`sqrt {x} + 1 over 2` 의 ` + 1 ` 증발 방지)을 유지·일반화.
 * - 연속 over 는 왼쪽부터 묶는다 (`a over b over c` = (a/b)/c). 원본은
 *   `\frac{a} \frac{b} {c}` 처럼 인자 없는 `\frac` 을 남겼다.
 * - `of` 는 root 의 지수 뒤에서만 찾고(kordoc 의 수정 유지), `of` 가 없으면
 *   `\sqrt{A}` 로 둔다. 원본은 밑 그룹 뒤 한 글자를 잘라 먹었다.
 * - atop 추가. 예약어는 리터럴 토큰과 구분되므로 `"over"` 는 글자 그대로 남는다.
 */
import {
  argumentEnd,
  isScriptOp,
  itemEnd,
  scriptChainEnd,
  signedItemEnd,
  startsItem,
} from "./items.js";
import { isSizer } from "./left-right.js";
import {
  type EqToken,
  isClose,
  isOpen,
  isSingleGroup,
  isValue,
  makeToken,
} from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;

/** `[start, end)` 의 내용 — 중괄호 그룹 하나면 그 안쪽 */
function contentOf(tokens: Tokens, start: number, end: number): Array<EqToken> {
  return isSingleGroup(tokens, start, end)
    ? tokens.slice(start + 1, end - 1)
    : tokens.slice(start, end);
}

function braced(content: ReadonlyArray<EqToken>): Array<EqToken> {
  return [makeToken("{"), ...content, makeToken("}")];
}

function findKeyword(tokens: Tokens, keywords: ReadonlySet<string>): number {
  return tokens.findIndex(
    (token) => token.kind !== "literal" && keywords.has(token.value),
  );
}

/**
 * 지수에 대괄호가 있으면 옵션 인자가 일찍 닫히고, `{` 로 시작하면 KaTeX 가
 * 옵션 인자를 잘못 읽는다(`\sqrt[{}_{}]{}` 실측 오류) — 그때만 `[{…}]` 로 감싼다.
 */
function rootIndex(content: ReadonlyArray<EqToken>): Array<EqToken> {
  const first = content[0];
  // `{}^{\circ}`(DEG) 처럼 `{` 로 시작하는 원자 토큰도 같다
  const startsWithBrace =
    first !== undefined &&
    first.kind !== "literal" &&
    first.value.startsWith("{");
  const needsBraces =
    startsWithBrace ||
    content.some((token) => isValue(token, "[") || isValue(token, "]"));
  return needsBraces ? braced(content) : [...content];
}

function replaceRoot(tokens: Tokens, root: number): Array<EqToken> {
  const gap = tokens[root]?.gap ?? true;
  const sqrt = makeToken("\\sqrt", "atom", gap);
  const indexEnd = argumentEnd(tokens, root + 1);
  const index = contentOf(tokens, root + 1, indexEnd);
  if (!isValue(tokens[indexEnd], "of")) {
    return [
      ...tokens.slice(0, root),
      sqrt,
      ...braced(index),
      ...tokens.slice(indexEnd),
    ];
  }
  const radicandEnd = argumentEnd(tokens, indexEnd + 1);
  return [
    ...tokens.slice(0, root),
    sqrt,
    makeToken("["),
    ...rootIndex(index),
    makeToken("]"),
    ...braced(contentOf(tokens, indexEnd + 1, radicandEnd)),
    ...tokens.slice(radicandEnd),
  ];
}

export function rewriteRoots(tokens: Tokens): Array<EqToken> {
  const roots = new Set(["root"]);
  let current = [...tokens];
  for (let at = findKeyword(current, roots); at >= 0; ) {
    current = replaceRoot(current, at);
    at = findKeyword(current, roots);
  }
  return current;
}

/** `index` 를 감싸는 그룹(또는 `\left…\right`) 안쪽의 시작 */
function enclosingStart(tokens: Tokens, index: number): number {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (isClose(token) || isValue(token, "\\right")) depth += 1;
    else if (isOpen(token) || isValue(token, "\\left")) {
      if (depth === 0) return isSizer(token) ? i + 2 : i + 1;
      depth -= 1;
    }
  }
  return 0;
}

/** 이 위치에서 시작하는 분할 단위의 끝 — 항, 밑 없는 첨자 사슬, 또는 토큰 하나 */
function unitEnd(tokens: Tokens, index: number): number {
  if (startsItem(tokens, index)) return itemEnd(tokens, index, true);
  if (isScriptOp(tokens[index])) return scriptChainEnd(tokens, index);
  return index + 1;
}

/**
 * over 바로 앞 항의 시작. 같은 수준을 앞에서부터 항 단위로 나눠, over 직전에
 * 끝나는 단위를 고른다. 그 단위가 항이 아니면(`= over 2`) 빈 분자.
 * 밑 없는 첨자(`= _{a} over b`)는 첨자째 분자가 된다 — 첨자 인자 그룹만
 * 떼어 가면 `_\frac{…}` 처럼 인자 없는 첨자가 남는다.
 */
function numeratorStart(tokens: Tokens, keyword: number): number {
  let i = enclosingStart(tokens, keyword);
  while (i < keyword) {
    const end = unitEnd(tokens, i);
    if (end > keyword) return keyword;
    if (end === keyword)
      return end - i > 1 || startsItem(tokens, i) ? i : keyword;
    i = end;
  }
  return keyword;
}

/**
 * `\atop` 은 그룹 하나에 하나뿐인 중위 연산자다 — 양쪽을 각자 그룹으로 두어
 * 연속 atop 이나 안쪽 줄바꿈(gathered)이 같은 그룹에 섞이지 않게 한다.
 */
function atopSide(content: ReadonlyArray<EqToken>): Array<EqToken> {
  const single = content.length === 1 ? content[0] : undefined;
  return single && single.kind !== "symbol" ? [single] : braced(content);
}

function replaceFraction(tokens: Tokens, keyword: number): Array<EqToken> {
  const start = numeratorStart(tokens, keyword);
  const end = signedItemEnd(tokens, keyword + 1);
  const numerator = contentOf(tokens, start, keyword);
  const denominator = contentOf(tokens, keyword + 1, end);
  const gap = tokens[start]?.gap ?? true;
  const fraction = isValue(tokens[keyword], "atop")
    ? [
        makeToken("{", "symbol", gap),
        ...atopSide(numerator),
        makeToken("\\atop"),
        ...atopSide(denominator),
        makeToken("}"),
      ]
    : [
        makeToken("\\frac", "atom", gap),
        ...braced(numerator),
        ...braced(denominator),
      ];
  return [...tokens.slice(0, start), ...fraction, ...tokens.slice(end)];
}

export function rewriteFractions(tokens: Tokens): Array<EqToken> {
  const keywords = new Set(["over", "atop"]);
  let current = [...tokens];
  for (let at = findKeyword(current, keywords); at >= 0; ) {
    current = replaceFraction(current, at);
    at = findKeyword(current, keywords);
  }
  return current;
}
