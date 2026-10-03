/**
 * 이중 첨자 방지 (새로 작성 — kordoc·hml-equation-parser 에는 없다).
 *
 * LaTeX 는 한 밑에 같은 첨자가 두 번 붙거나(`x_{a}_{b}`, `UNDERBRACE` 뒤의 `_`),
 * 위첨자 뒤에 프라임이 오면(`x^{2}'`, `DEG` 뒤의 `^`) "Double superscript"
 * 오류로 수식 전체를 버린다. 한컴은 이런 입력을 받아 주므로, 두 번째 첨자
 * 앞에 빈 밑 `{}` 를 넣어 유효하게 만든다 (모양은 거의 같다).
 */
import {
  type EqToken,
  findClose,
  isOpen,
  isValue,
  makeToken,
} from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;
type ScriptKind = "^" | "_" | "'";

function scriptKind(token: EqToken | undefined): ScriptKind | null {
  if (isValue(token, "^")) return "^";
  if (isValue(token, "_")) return "_";
  if (isValue(token, "'")) return "'";
  return null;
}

/** `{}^{\circ}`(DEG) 처럼 위첨자로 끝나는 원자 */
function endsWithSuperscript(token: EqToken): boolean {
  return token.kind !== "literal" && /\^\{[^{}]*\}$/.test(token.value);
}

/**
 * 프라임은 위첨자의 일종이라, 이어진 프라임(`f''`)과 프라임 바로 뒤 위첨자
 * (`x'^{2}`)만 허용된다. 위첨자 뒤 프라임(`x^{2}'`), 다른 첨자를 사이에 둔
 * 프라임·위첨자(`x'_{a}'`, `x'_{a}^{b}`)는 이중 위첨자다.
 */
function conflicts(
  used: ReadonlySet<ScriptKind>,
  kind: ScriptKind,
  previous: ScriptKind | null,
): boolean {
  if (kind === "_") return used.has("_");
  const primeApart = used.has("'") && previous !== "'";
  return used.has("^") || primeApart;
}

/** `index` 에서 시작하는 그룹(또는 토큰 하나)의 끝 */
function unitEnd(tokens: Tokens, index: number, end: number): number {
  if (index >= end) return index;
  if (!isOpen(tokens[index])) return index + 1;
  const close = findClose(tokens, index);
  return close < 0 || close >= end ? index + 1 : close + 1;
}

function copyUnit(tokens: Tokens, start: number, end: number): Array<EqToken> {
  const first = tokens[start];
  const last = tokens[end - 1];
  if (end - start >= 2 && first && last && isOpen(first)) {
    return [first, ...separateRange(tokens, start + 1, end - 1), last];
  }
  return tokens.slice(start, end);
}

function separateRange(
  tokens: Tokens,
  start: number,
  end: number,
): Array<EqToken> {
  const separated: Array<EqToken> = [];
  let used: ReadonlySet<ScriptKind> = new Set();
  let previous: ScriptKind | null = null;
  let i = start;
  while (i < end) {
    const token = tokens[i];
    if (token === undefined) break;
    const kind = scriptKind(token);
    if (kind === null) {
      const next = unitEnd(tokens, i, end);
      separated.push(...copyUnit(tokens, i, next));
      used = endsWithSuperscript(token) ? new Set(["^"]) : new Set();
      previous = null;
      i = next;
      continue;
    }
    if (conflicts(used, kind, previous)) {
      separated.push(makeToken("{"), makeToken("}", "symbol", false));
      used = new Set();
    }
    used = new Set([...used, kind]);
    previous = kind;
    separated.push(token);
    i += 1;
    if (kind !== "'") {
      const next = unitEnd(tokens, i, end);
      separated.push(...copyUnit(tokens, i, next));
      i = next;
    }
  }
  return separated;
}

export function separateDoubleScripts(tokens: Tokens): Array<EqToken> {
  return separateRange(tokens, 0, tokens.length);
}
