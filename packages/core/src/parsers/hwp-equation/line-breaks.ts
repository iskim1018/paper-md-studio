/**
 * 행렬 밖의 `#`(한컴 줄바꿈)과 `&`(세로 맞춤) 처리
 * (새로 작성 — kordoc·hml-equation-parser 에는 없다).
 *
 * 원본은 행렬 본문의 `#` 만 `\\` 로 바꿔, 여러 줄 수식의 최상위 `#` 가 그대로
 * 새어 나갔다. LaTeX 에서 `#` 는 매크로 인자 기호라 수식 전체가 오류가 된다.
 *
 * 결정: 줄이 둘 이상인 수준(최상위, 또는 `{…}`·`\left…\right` 안쪽)을
 * `\begin{gathered} 줄 \\ 줄 \end{gathered}` 로 감싼다. 그 수준에 `&` 가 있으면
 * 한컴의 세로 맞춤이므로 `aligned` 를 쓴다. 맨몸의 `\\` 는 인라인 수식에서
 * 환경 밖 줄바꿈이라 LaTeX·MathJax 가 무시하거나 거부한다 — gathered/aligned 는
 * amsmath·KaTeX·MathJax 모두 인라인에서도 받는다. 빈 줄(끝에 붙은 `#`)은 버리고,
 * 줄바꿈 없는 수준의 `&` 는 정렬할 대상이 없으므로 버린다.
 */
import { findMatchingRight } from "./left-right.js";
import { ROW_BREAK } from "./rewrite-structures.js";
import {
  type EqToken,
  findClose,
  isOpen,
  isValue,
  makeToken,
} from "./tokens.js";

type Tokens = ReadonlyArray<EqToken>;
type LevelKind = "env" | "plain";

interface NestedSpan {
  /** 안쪽 내용의 시작 (여는 토큰들 바로 뒤) */
  readonly inner: number;
  /** 닫는 토큰의 위치 */
  readonly close: number;
  readonly kind: LevelKind;
}

interface LevelParts {
  /** 이 수준의 `#` 로 나눈 줄 (중첩 구조는 이미 처리된 토큰으로 들어 있다) */
  readonly lines: ReadonlyArray<ReadonlyArray<EqToken>>;
  /** 이 수준에 속한 `&` 토큰 (중첩 환경 안의 `&` 와 구분하려고 객체로 기억) */
  readonly alignmentMarks: ReadonlySet<EqToken>;
}

function startsWithValue(token: EqToken | undefined, prefix: string): boolean {
  return (
    token !== undefined &&
    token.kind !== "literal" &&
    token.value.startsWith(prefix)
  );
}

function findEnvironmentEnd(tokens: Tokens, begin: number): number {
  let depth = 0;
  for (let i = begin; i < tokens.length; i += 1) {
    if (startsWithValue(tokens[i], "\\begin{")) depth += 1;
    else if (startsWithValue(tokens[i], "\\end{")) depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

function span(
  inner: number,
  close: number,
  kind: LevelKind,
): NestedSpan | null {
  return close < 0 ? null : { inner, close, kind };
}

/** 이 위치에서 시작하는 중첩 구조 — 아니면 null */
function nestedSpan(tokens: Tokens, index: number): NestedSpan | null {
  const token = tokens[index];
  if (isOpen(token)) return span(index + 1, findClose(tokens, index), "plain");
  if (isValue(token, "\\left")) {
    return span(index + 2, findMatchingRight(tokens, index), "plain");
  }
  if (startsWithValue(token, "\\begin{")) {
    return span(index + 1, findEnvironmentEnd(tokens, index), "env");
  }
  return null;
}

/** 중첩 구조를 재귀 처리한 토큰 (여는·닫는 토큰 포함) */
function expandNested(
  tokens: Tokens,
  start: number,
  nested: NestedSpan,
): Array<EqToken> {
  const inner = tokens.slice(nested.inner, nested.close);
  return [
    ...tokens.slice(start, nested.inner),
    ...transformLevel(inner, nested.kind),
    ...tokens.slice(nested.close, nested.close + 1),
  ];
}

/** 한 수준을 훑어 중첩 구조는 재귀 처리하고, 이 수준의 `#`·`&` 를 모은다 */
function scanLevel(tokens: Tokens, kind: LevelKind): LevelParts {
  const lines: Array<Array<EqToken>> = [[]];
  const alignmentMarks = new Set<EqToken>();
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const line = lines.at(-1);
    if (token === undefined || line === undefined) break;
    const nested = nestedSpan(tokens, i);
    if (nested !== null) {
      line.push(...expandNested(tokens, i, nested));
      i = nested.close + 1;
      continue;
    }
    if (isValue(token, "#")) {
      if (kind === "plain") lines.push([]);
      else line.push(makeToken(ROW_BREAK));
    } else {
      if (isValue(token, "&")) alignmentMarks.add(token);
      line.push(token);
    }
    i += 1;
  }
  return { lines, alignmentMarks };
}

function transformLevel(tokens: Tokens, kind: LevelKind): Array<EqToken> {
  const { lines, alignmentMarks } = scanLevel(tokens, kind);
  if (kind === "env") return lines.flat();
  const filled = lines.filter((line) => line.length > 0);
  if (filled.length <= 1) {
    return filled.flat().filter((token) => !alignmentMarks.has(token));
  }
  const name = alignmentMarks.size > 0 ? "aligned" : "gathered";
  const body = filled.flatMap((line, index) =>
    index === 0 ? [...line] : [makeToken(ROW_BREAK), ...line],
  );
  return [
    makeToken(`\\begin{${name}}`, "atom", filled[0]?.[0]?.gap ?? true),
    ...body,
    makeToken(`\\end{${name}}`),
  ];
}

export function rewriteLineBreaks(tokens: Tokens): Array<EqToken> {
  return transformLevel(tokens, "plain");
}
