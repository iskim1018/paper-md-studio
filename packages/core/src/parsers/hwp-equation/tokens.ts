/**
 * 한컴 수식 토큰과 중괄호 짝 찾기.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 findBrackets·findEnclosingBrackets
 * (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 OpenBapul/hml-equation-parser
 * `hulkReplaceMethod.py` 의 `_findBrackets` (Apache-2.0, Copyright 2018 Open Bapul).
 *
 * 변경 사항 (Apache-2.0 §4(b)): 문자열 인덱스를 뒤집어 거꾸로 찾던 방식을
 * 토큰 배열 위의 깊이 계산으로 바꿨다. 중괄호는 렉싱 직후 균형을 맞춰 두므로
 * 이후 단계는 짝이 항상 있다고 가정할 수 있다 (없으면 -1 로 방어).
 */

/**
 * - atom: 단어·숫자·명령 (공백 없이 붙어 있으면 한 항으로 묶인다)
 * - symbol: 연산자·문장부호·구조 문자 (항을 끊는다)
 * - literal: `\text{}` 로 감쌀 원문 (따옴표 리터럴, 한글)
 */
export type EqTokenKind = "atom" | "symbol" | "literal";

export interface EqToken {
  readonly value: string;
  readonly kind: EqTokenKind;
  /** 원문에서 바로 앞에 공백이 있었는가 — 항 묶기와 출력 간격에 쓴다 */
  readonly gap: boolean;
}

export function makeToken(
  value: string,
  kind: EqTokenKind = "symbol",
  gap = true,
): EqToken {
  return { value, kind, gap };
}

/** 리터럴이 아닌 토큰의 값이 `value` 인가 */
export function isValue(token: EqToken | undefined, value: string): boolean {
  return (
    token !== undefined && token.kind !== "literal" && token.value === value
  );
}

export function isOpen(token: EqToken | undefined): boolean {
  return isValue(token, "{");
}

export function isClose(token: EqToken | undefined): boolean {
  return isValue(token, "}");
}

/** `open` 위치의 `{` 와 짝인 `}` 의 인덱스. 없으면 -1 */
export function findClose(
  tokens: ReadonlyArray<EqToken>,
  open: number,
): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (isOpen(tokens[i])) depth += 1;
    else if (isClose(tokens[i])) depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

/** `[start, end)` 가 정확히 중괄호 그룹 하나인가 */
export function isSingleGroup(
  tokens: ReadonlyArray<EqToken>,
  start: number,
  end: number,
): boolean {
  return isOpen(tokens[start]) && findClose(tokens, start) === end - 1;
}

/** 짝 없는 `}` 를 버리고 닫히지 않은 `{` 를 끝에서 닫는다 */
export function balanceBraces(tokens: ReadonlyArray<EqToken>): Array<EqToken> {
  const balanced: Array<EqToken> = [];
  let depth = 0;
  for (const token of tokens) {
    if (isClose(token)) {
      if (depth === 0) continue;
      depth -= 1;
    } else if (isOpen(token)) {
      depth += 1;
    }
    balanced.push(token);
  }
  const closers = Array.from({ length: depth }, () => makeToken("}"));
  return [...balanced, ...closers];
}
