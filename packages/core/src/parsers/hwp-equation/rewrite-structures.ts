/**
 * 행렬·조건식·장식·묶음괄호 표식(HULK*)을 LaTeX 로 펼친다.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 replaceAllMatrix·replaceAllBar·
 * replaceAllBrace (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은
 * hml-equation-parser `hulkReplaceMethod.py` 의 같은 이름 함수들
 * (Apache-2.0, Copyright 2018 Open Bapul).
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - 인자 감싸기 패스 뒤라 모든 표식 뒤에 `{…}` 가 있다 — "첫 `{` 를 찾아
 *   그 앞을 잘라내는" 문자열 탐색 대신 바로 뒤 그룹만 본다.
 * - 바깥 그룹을 통째로 바꿔치우지 않는다 (그룹 안 다른 내용 보존).
 * - 행렬 본문의 `#` 는 본문 자기 수준의 것만 행 구분 `\\` 로 바꾼다.
 *   중첩 그룹 안의 `#` 는 line-breaks.ts 가 그 그룹 안에서 처리한다.
 */
import { lookup } from "./convert-map.js";
import { ACCENT_MAP, BRACE_MAP, MATRIX_MAP } from "./keyword-maps.js";
import {
  type EqToken,
  findClose,
  isClose,
  isOpen,
  isValue,
  makeToken,
} from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;

export const ROW_BREAK = "\\\\";

function markerValue(token: EqToken): string | undefined {
  return token.kind === "literal" ? undefined : token.value;
}

/** 본문 자기 수준의 `#` → `\\` */
function rowsOf(body: Tokens): Array<EqToken> {
  let depth = 0;
  return body.map((token) => {
    if (isOpen(token)) depth += 1;
    else if (isClose(token)) depth -= 1;
    else if (depth === 0 && isValue(token, "#")) return makeToken(ROW_BREAK);
    return token;
  });
}

export function rewriteMatrices(tokens: Tokens): Array<EqToken> {
  const rewritten: Array<EqToken> = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) break;
    const spec = lookup(MATRIX_MAP, markerValue(token) ?? "");
    const close = spec && isOpen(tokens[i + 1]) ? findClose(tokens, i + 1) : -1;
    if (spec === undefined || close < 0) {
      // 인자가 없는 표식은 버린다 (인자 감싸기 뒤라 실제로는 생기지 않는다)
      if (spec === undefined) rewritten.push(token);
      i += 1;
      continue;
    }
    const body = rewriteMatrices(tokens.slice(i + 2, close));
    rewritten.push(
      makeToken(spec.begin, "atom", token.gap),
      ...rowsOf(body),
      makeToken(spec.end),
    );
    i = close + 1;
  }
  return rewritten;
}

export function rewriteAccents(tokens: Tokens): Array<EqToken> {
  return tokens.map((token) => {
    const command = lookup(ACCENT_MAP, markerValue(token) ?? "");
    return command === undefined ? token : { ...token, value: command };
  });
}

/** `HULKOVERBRACE {본문} {라벨}` → `\overbrace{본문}^{라벨}` */
export function rewriteBraces(tokens: Tokens): Array<EqToken> {
  const insertAfter = new Map<number, string>();
  tokens.forEach((token, index) => {
    const spec = lookup(BRACE_MAP, markerValue(token) ?? "");
    if (spec === undefined || !isOpen(tokens[index + 1])) return;
    insertAfter.set(findClose(tokens, index + 1), spec.script);
  });
  return tokens.flatMap((token, index) => {
    const spec = lookup(BRACE_MAP, markerValue(token) ?? "");
    const current = spec ? { ...token, value: spec.command } : token;
    const script = insertAfter.get(index);
    return script === undefined ? [current] : [current, makeToken(script)];
  });
}
