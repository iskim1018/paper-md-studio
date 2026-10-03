/**
 * 인자 감싸기 패스 — 괄호 없이 쓴 첨자·근호·장식 인자를 `{…}` 로 감싼다
 * (새로 작성 — kordoc 의 HWP5 사전 정규화 normalizeScripts 를 일반화한 것).
 *
 * kordoc 4.7.2 `src/hwp5/equation.ts` (MIT, Copyright (c) 2026 chrisryugj) 는
 * `^`·`_` 뒤의 "공백·중괄호가 아닌 글자 덩어리"를 감쌌는데, 그러면
 * `x^2+1` 이 `x^{2+1}` 이 된다. 여기서는 items.ts 의 항 규칙으로 인자를
 * 정해 `x^{2}+1` 로 두고, 같은 규칙을 sqrt·장식·행렬 표식에도 적용한다.
 * 이 패스 뒤에는 모든 명령 인자가 중괄호 그룹이라 이후 패스가 단순해진다.
 */
import { argumentEnd, isScriptOp, scriptArgumentEnd } from "./items.js";
import { arityOf } from "./keyword-maps.js";
import {
  type EqToken,
  findClose,
  isOpen,
  isSingleGroup,
  makeToken,
} from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;

function argumentCount(token: EqToken): number {
  if (token.kind === "literal") return 0;
  return isScriptOp(token) ? 1 : arityOf(token.value);
}

/** `[start, end)` 를 중괄호 그룹 하나로 — 이미 그룹이면 안쪽만 재귀 처리 */
function asGroup(tokens: Tokens, start: number, end: number): Array<EqToken> {
  if (isSingleGroup(tokens, start, end)) {
    const open = tokens[start] ?? makeToken("{");
    const close = tokens[end - 1] ?? makeToken("}");
    return [open, ...wrapRange(tokens, start + 1, end - 1), close];
  }
  const gap = tokens[start]?.gap ?? true;
  return [
    makeToken("{", "symbol", gap),
    ...wrapRange(tokens, start, end),
    makeToken("}"),
  ];
}

function wrapRange(tokens: Tokens, start: number, end: number): Array<EqToken> {
  const wrapped: Array<EqToken> = [];
  let i = start;
  while (i < end) {
    const token = tokens[i];
    if (token === undefined) break;
    const close = isOpen(token) ? findClose(tokens, i) : -1;
    if (close > i && close < end) {
      wrapped.push(...asGroup(tokens, i, close + 1));
      i = close + 1;
      continue;
    }
    wrapped.push(token);
    i += 1;
    for (let k = 0; k < argumentCount(token); k += 1) {
      const argEnd = isScriptOp(token)
        ? scriptArgumentEnd(tokens, i, token.value)
        : argumentEnd(tokens, i);
      const bounded = Math.min(argEnd, end);
      wrapped.push(...asGroup(tokens, i, bounded));
      i = bounded;
    }
  }
  return wrapped;
}

export function wrapArguments(tokens: Tokens): Array<EqToken> {
  return wrapRange(tokens, 0, tokens.length);
}
