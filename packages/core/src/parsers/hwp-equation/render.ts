/**
 * 토큰 → LaTeX 문자열 (새로 작성 — kordoc 은 토큰을 공백 하나로 이었다).
 *
 * 출력은 Markdown 의 인라인 수식(`$…$`)과 GFM 표 셀 안에 그대로 들어간다.
 * - 줄바꿈 없음: 공백류는 모두 공백 하나로.
 * - `|` 없음: `\vert`·`\Vert`·`\textbar{}` 로 (표 셀 구분자). 토큰 단계에서
 *   이미 바뀌지만 마지막에 한 번 더 막는다.
 * - `$` 없음: 인라인 수식을 일찍 닫는다 — `\textdollar` 로.
 * - 역따옴표 없음: 수식 밖에서는 코드 스팬을 연다 — 리터럴 안의 것은 ˋ(U+02CB) 로.
 *   (리터럴 밖의 역따옴표는 한컴의 1/4 공백이라 렉서가 이미 공백으로 읽는다.)
 * - 간격: 원문에서 붙어 있던 토큰은 붙이고(`2a`, `f(x)`), 중괄호·첨자 주변은
 *   항상 붙인다(`\frac{1}{2}`, `x^{2}`). 단, 제어어 뒤에 글자를 붙이면 다른
 *   명령이 되므로(`\pm` + `b` → `\pmb`) 그때는 띄운다.
 */
import { lookup } from "./convert-map.js";
import { ROW_BREAK } from "./rewrite-structures.js";
import type { EqToken } from "./tokens.js";

interface Rendered {
  readonly text: string;
  readonly gap: boolean;
}

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\textdollar{}",
  "%": "\\%",
  "#": "\\#",
  "&": "\\&",
  _: "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
  "|": "\\textbar{}",
};

function escapeText(text: string): string {
  return text
    .replace(/[\\{}$%#&_^~|]/g, (ch) => lookup(TEXT_ESCAPES, ch) ?? ch)
    .replace(/`/g, "\u02cb"); // 역따옴표는 Markdown 코드 스팬을 연다 — 모양이 같은 ˋ 로
}

function renderLiteral(text: string): string {
  return text.trim() === "" ? "\\;" : `\\text{${escapeText(text)}}`;
}

function endsWithControlWord(text: string): boolean {
  return /\\[A-Za-z]+$/.test(text);
}

function isEnvironmentBoundary(text: string): boolean {
  return text.startsWith("\\begin{") || text.startsWith("\\end{");
}

/** 두 조각 사이에 공백이 필요한가 */
function needsSpace(previous: Rendered, next: Rendered): boolean {
  if (previous.text === ROW_BREAK || next.text === ROW_BREAK) return true;
  if (/[{([^_]$/.test(previous.text)) return false;
  if (/^[{}^_)\]',]/.test(next.text)) return false;
  if (previous.text === "\\left" || previous.text === "\\right") return false;
  if (previous.text === "\\sqrt" && next.text === "[") return false;
  if (isEnvironmentBoundary(previous.text)) return true;
  if (isEnvironmentBoundary(next.text)) return true;
  if (next.gap) return true;
  // 원문에서 붙어 있던 토큰 — 제어어 뒤 글자만 아니면 붙인다
  return endsWithControlWord(previous.text) && /^[A-Za-z]/.test(next.text);
}

function renderToken(token: EqToken): Rendered {
  const text =
    token.kind === "literal" ? renderLiteral(token.value) : token.value;
  return { text, gap: token.gap };
}

/** 표 셀·인라인 수식을 깨는 문자를 마지막으로 한 번 더 막는다 */
function makeEmbeddable(latex: string): string {
  return latex
    .replace(/\\\|/g, "\\Vert ")
    .replace(/\|/g, "\\vert ")
    .replace(/\$/g, "\\text{\\textdollar}")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderTokens(tokens: ReadonlyArray<EqToken>): string {
  const parts = tokens.map(renderToken).filter((part) => part.text.length > 0);
  const joined = parts
    .map((part, index) => {
      const previous = parts[index - 1];
      if (previous === undefined) return part.text;
      return needsSpace(previous, part) ? ` ${part.text}` : part.text;
    })
    .join("");
  return makeEmbeddable(joined);
}

/** 간격·구조 명령만 남은 출력(`{}`, `\;`)은 의미 있는 결과가 아니다 */
export function hasVisibleContent(latex: string): boolean {
  const stripped = latex
    .replace(/\\(?:[;,:! ]|quad|qquad)/g, "")
    .replace(/\\(?:begin|end)\{[a-z]+\}/g, "")
    .replace(/\\\\/g, "")
    .replace(/[{}\s]/g, "");
  return stripped.length > 0;
}
