/**
 * `root A of B` → `\sqrt[A]{B}`, `A over B` → `\frac{A}{B}`, `A atop B` → `{A \atop B}`.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 replaceFrac·replaceRootOf
 * (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 hml-equation-parser
 * `hulkReplaceMethod.py` 의 replaceFrac·replaceRootOf (Apache-2.0,
 * Copyright 2018 Open Bapul).
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - 분자·분모를 items.ts 의 항 규칙으로 정한다. 원본은 분모를 감싸지 않아
 *   `a over bc` 가 `\frac{a} bc`(= a/b · c), `1 over sqrt {x}` 가 렌더링 오류가 됐다.
 * - 분자는 같은 그룹(또는 `\left…\right`) 안에서 over 바로 앞 항만 — kordoc 의
 *   "인접 분자" 수정(`sqrt {x} + 1 over 2` 의 ` + 1 ` 증발 방지)을 유지·일반화.
 *   맨 괄호 `(…)`·`[…]` 안의 over 도 그 안에서 찾는다 (numerator.ts).
 * - 연속 over 는 왼쪽부터 묶는다 (`a over b over c` = (a/b)/c). 원본은
 *   `\frac{a} \frac{b} {c}` 처럼 인자 없는 `\frac` 을 남겼다.
 * - `of` 는 root 의 지수 뒤에서만 찾고(kordoc 의 수정 유지), `of` 가 없으면
 *   `\sqrt{A}` 로 둔다. 원본은 밑 그룹 뒤 한 글자를 잘라 먹었다.
 * - atop 추가. 예약어는 리터럴 토큰과 구분되므로 `"over"` 는 글자 그대로 남는다.
 */
import { assertShallowEnough, spendSteps } from "./budget.js";
import { argumentEnd, signedItemEnd } from "./items.js";
import { afterRewrite, findNumerator, type WalkResume } from "./numerator.js";
import { MEMO_KIND, remember } from "./token-memo.js";
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

/**
 * `from` 부터 첫 예약어 위치. 재작성은 늘 첫 예약어에서 하고 그 앞은 바꾸지
 * 않으므로, 다음 탐색은 직전 재작성 시작점부터면 된다.
 */
function findKeyword(
  tokens: Tokens,
  keywords: ReadonlySet<string>,
  from: number,
): number {
  for (let i = from; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token && token.kind !== "literal" && keywords.has(token.value)) {
      return i;
    }
  }
  return -1;
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
    spendSteps(indexEnd - root);
    return tokens
      .slice(0, root)
      .concat([sqrt, ...braced(index)], tokens.slice(indexEnd));
  }
  const radicandEnd = argumentEnd(tokens, indexEnd + 1);
  spendSteps(radicandEnd - root);
  const replacement = [
    sqrt,
    makeToken("["),
    ...rootIndex(index),
    makeToken("]"),
    ...braced(contentOf(tokens, indexEnd + 1, radicandEnd)),
  ];
  return tokens.slice(0, root).concat(replacement, tokens.slice(radicandEnd));
}

export function rewriteRoots(tokens: Tokens): Array<EqToken> {
  const roots = new Set(["root"]);
  let current = [...tokens];
  for (let at = findKeyword(current, roots, 0); at >= 0; ) {
    current = replaceRoot(current, at);
    at = findKeyword(current, roots, at);
  }
  return current;
}

/**
 * `\atop` 은 그룹 하나에 하나뿐인 중위 연산자다 — 양쪽을 각자 그룹으로 두어
 * 연속 atop 이나 안쪽 줄바꿈(gathered)이 같은 그룹에 섞이지 않게 한다.
 */
function atopSide(content: ReadonlyArray<EqToken>): Array<EqToken> {
  const single = content.length === 1 ? content[0] : undefined;
  return single && single.kind !== "symbol" ? [single] : braced(content);
}

/** 재작성한 분수와, 아직 처리하지 않은 예약어가 남아 있을 수 있는 분모의 자리 */
interface Rewritten {
  readonly tokens: Array<EqToken>;
  readonly fractionLength: number;
  /** 분모 내용의 시작 — 분자 쪽에는 남은 예약어가 없다(왼쪽부터 처리) */
  readonly denominatorAt: number;
}

/** 새로 만든 중괄호의 짝을 새 배열에 미리 알려 둔다 — 다음 over 가 다시 훑지 않게 */
function rememberBraces(
  tokens: ReadonlyArray<EqToken>,
  offset: number,
  fraction: ReadonlyArray<EqToken>,
): void {
  const opens: Array<number> = [];
  fraction.forEach((token, index) => {
    if (isOpen(token)) opens.push(index);
    else if (isClose(token)) {
      const open = opens.pop();
      if (open !== undefined) {
        remember(tokens, MEMO_KIND.brace, offset + open, offset + index);
      }
    }
  });
}

function fractionTokens(
  tokens: Tokens,
  keyword: number,
  numerator: ReadonlyArray<EqToken>,
  denominator: ReadonlyArray<EqToken>,
  gap: boolean,
): Array<EqToken> {
  if (isValue(tokens[keyword], "atop")) {
    return [
      makeToken("{", "symbol", gap),
      ...atopSide(numerator),
      makeToken("\\atop"),
      ...atopSide(denominator),
      makeToken("}"),
    ];
  }
  return [
    makeToken("\\frac", "atom", gap),
    ...braced(numerator),
    ...braced(denominator),
  ];
}

function replaceFraction(
  tokens: Tokens,
  keyword: number,
  start: number,
): Rewritten {
  const end = signedItemEnd(tokens, keyword + 1);
  spendSteps(end - start);
  const numerator = contentOf(tokens, start, keyword);
  const denominator = contentOf(tokens, keyword + 1, end);
  const gap = tokens[start]?.gap ?? true;
  const fraction = fractionTokens(tokens, keyword, numerator, denominator, gap);
  // 연속 over 는 분수가 분수를 품으며 한 단계씩 깊어진다 — 패스가 끝나길
  // 기다리지 않고 만드는 즉시 막는다 (`a over a over …` 수천 개)
  assertShallowEnough(fraction);
  const rewritten = tokens.slice(0, start).concat(fraction, tokens.slice(end));
  rememberBraces(rewritten, start, fraction);
  return {
    tokens: rewritten,
    fractionLength: fraction.length,
    // 분수 끝에서 분모 내용과 닫는 토큰을 거슬러 센다. 한 칸 앞(`{`·`\atop`)
    // 에서 시작해도 예약어가 아니라 무해하다 — 분모 첫 토큰을 건너뛰지 않게
    denominatorAt: start + fraction.length - 2 - denominator.length,
  };
}

/**
 * 예약어를 왼쪽부터 하나씩 분수로 바꾼다 — 연속 over 는 왼쪽부터 묶인다.
 * 분자 탐색은 직전 탐색을 이어 쓰고(numerator.ts), 다음 예약어는 분모부터
 * 찾는다. 그래서 over 하나의 일은 그 주변에 비례한다 (배열 복사는 빼고).
 */
export function rewriteFractions(tokens: Tokens): Array<EqToken> {
  const keywords = new Set(["over", "atop"]);
  let current: Array<EqToken> = [...tokens];
  let previous: WalkResume | null = null;
  for (let at = findKeyword(current, keywords, 0); at >= 0; ) {
    const walk = findNumerator(current, at, previous);
    const next = replaceFraction(current, at, walk.start);
    const delta = next.tokens.length - current.length;
    previous = afterRewrite(walk, delta, next.fractionLength);
    current = next.tokens;
    at = findKeyword(current, keywords, next.denominatorAt);
  }
  return current;
}
