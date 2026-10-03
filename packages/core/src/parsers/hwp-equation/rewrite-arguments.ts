/**
 * 인자 감싸기 패스 — 괄호 없이 쓴 첨자·근호·장식 인자를 `{…}` 로 감싼다
 * (새로 작성 — kordoc 의 HWP5 사전 정규화 normalizeScripts 를 일반화한 것).
 *
 * kordoc 4.7.2 `src/hwp5/equation.ts` (MIT, Copyright (c) 2026 chrisryugj) 는
 * `^`·`_` 뒤의 "공백·중괄호가 아닌 글자 덩어리"를 감쌌는데, 그러면
 * `x^2+1` 이 `x^{2+1}` 이 된다. 여기서는 items.ts 의 항 규칙으로 인자를
 * 정해 `x^{2}+1` 로 두고, 같은 규칙을 sqrt·장식·행렬 표식에도 적용한다.
 * 이 패스 뒤에는 모든 명령 인자가 중괄호 그룹이라 이후 패스가 단순해진다.
 * @license kordoc: MIT — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 결과는 출력 배열 하나에 이어 붙인다. 중첩 단계마다 안쪽 결과를 새 배열로
 * 돌려받아 복사하면 겹친 첨자(`x^(x^(…`)에서 O(n·깊이) 가 된다. 재귀 깊이는
 * 예산(budget.ts)이 막는다.
 */
import { descend, spendSteps } from "./budget.js";
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
function appendGroup(
  tokens: Tokens,
  start: number,
  end: number,
  out: Array<EqToken>,
): void {
  descend(() => {
    if (isSingleGroup(tokens, start, end)) {
      out.push(tokens[start] ?? makeToken("{"));
      appendRange(tokens, start + 1, end - 1, out);
      out.push(tokens[end - 1] ?? makeToken("}"));
      return;
    }
    out.push(makeToken("{", "symbol", tokens[start]?.gap ?? true));
    appendRange(tokens, start, end, out);
    out.push(makeToken("}"));
  });
}

function appendRange(
  tokens: Tokens,
  start: number,
  end: number,
  out: Array<EqToken>,
): void {
  let i = start;
  while (i < end) {
    spendSteps(1);
    const token = tokens[i];
    if (token === undefined) break;
    const close = isOpen(token) ? findClose(tokens, i) : -1;
    if (close > i && close < end) {
      appendGroup(tokens, i, close + 1, out);
      i = close + 1;
      continue;
    }
    out.push(token);
    i += 1;
    for (let k = 0; k < argumentCount(token); k += 1) {
      const argEnd = isScriptOp(token)
        ? scriptArgumentEnd(tokens, i, token.value)
        : argumentEnd(tokens, i);
      const bounded = Math.min(argEnd, end);
      appendGroup(tokens, i, bounded, out);
      i = bounded;
    }
  }
}

export function wrapArguments(tokens: Tokens): Array<EqToken> {
  const out: Array<EqToken> = [];
  appendRange(tokens, 0, tokens.length, out);
  return out;
}
