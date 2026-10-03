import { hwpEquationToLatex } from "../hwp-equation/index.js";
import { escapeHtml } from "./inline-builder.js";
import { rawMarkdownHtml } from "./markdown.js";

/** 수식 렌더링 결과 — fallback이면 LaTeX 변환에 실패해 원본 스크립트를 코드로 냈다 */
export interface RenderedEquation {
  readonly html: string;
  readonly fallback: boolean;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function convert(script: string): string | null {
  try {
    const latex = hwpEquationToLatex(script);
    return latex ? collapseWhitespace(latex) || null : null;
  } catch {
    // 변환기 결함이 문서 전체를 실패시키면 안 된다 — 코드 폴백으로 남긴다
    return null;
  }
}

/**
 * GFM 표 셀은 "|"로 열을 나눈다. 수식 안의 `|`·`\|`가 셀을 쪼개지 않도록
 * 같은 뜻의 `\vert`·`\Vert`로 바꾼다 (본문에서도 같은 결과가 되도록 늘 적용).
 */
function neutralizePipes(latex: string): string {
  return collapseWhitespace(
    latex.replace(/\\\|/g, "\\Vert ").replace(/\|/g, "\\vert "),
  );
}

/**
 * 수식 모드에서 "$"를 그리는 LaTeX. `\textdollar`는 텍스트 모드 전용이라
 * KaTeX 수식 모드에서는 "Undefined control sequence"로 수식 전체가 깨진다
 * (KaTeX 0.16.45 실측) — 변환기(`hwp-equation/render.ts`)와 같은 꼴로 감싼다.
 */
const MATH_DOLLAR = "\\text{\\textdollar}";
/** 제어어(`\frac`)·제어 기호(`\$`·`\\`) 하나, 또는 맨 "$" 하나 */
const CONTROL_OR_DOLLAR = /\\(?:[A-Za-z]+|[^A-Za-z])|\$/g;

/**
 * 수식 안의 "$"를 모두 `MATH_DOLLAR`로 바꾼다. remark-math 는 수식 안에서
 * escape 를 모르므로(코드 구간처럼) `\$`의 "$"도 수식을 닫는다 — `$a\$b$`는
 * 수식 `a\`와 글자 `b$`가 되고, 남은 "$"가 뒤 수식과 짝을 지어 문단 전체가
 * 뒤섞인다. 제어 기호 단위로 읽어야 `\\$`(줄바꿈 + "$")와 `\$`를 가른다.
 */
function replaceDollars(latex: string): string {
  return latex.replace(CONTROL_OR_DOLLAR, (token) =>
    token === "$" || token === "\\$" ? MATH_DOLLAR : token,
  );
}

/**
 * 수식 스크립트는 문서가 정하므로, 날것으로 내보내는 LaTeX 가 수식 밖의
 * Markdown 문법이 되지 못하게 같은 뜻의 LaTeX 로 바꾼다. 수식 확장이 없는
 * 렌더러는 `$…$`를 글자로 읽기 때문에 그 안의 문법이 그대로 살아난다.
 * - `](` → `] (` : 링크 문법을 끊는다 (수식 안 공백은 렌더링에 영향 없음)
 * - `<`·`>` → `\lt`·`\gt` : 날것 HTML·자동 링크가 되지 않게
 * - 백틱 → `\,` : 코드 구간이 수식을 넘어 열리지 않게 (HWP 수식의 백틱은 얇은 공백)
 * - `$`(`\$` 포함) → `\text{\textdollar}` : 수식이 중간에 닫히지 않게
 */
function neutralizeMarkdown(latex: string): string {
  return collapseWhitespace(
    replaceDollars(
      latex
        .replace(/\](?=\()/g, "] ")
        .replace(/</g, " \\lt ")
        .replace(/>/g, " \\gt ")
        .replace(/`/g, "\\,"),
    ),
  );
}

/**
 * `<hp:equation><hp:script>`를 인라인 Markdown 수식으로 그린다.
 *
 * - 변환 성공: `$latex$`를 escape 없이 낸다 (`rawMarkdownHtml`). turndown이
 *   `_`·`*`·`[`·`\`를 escape하면 수식이 깨진다. `$$` 블록은 표 셀에 못 들어가
 *   늘 인라인으로 낸다.
 * - 변환 실패: 원본 스크립트를 공백만 접어 인라인 코드로 남긴다. 버리면
 *   내용이 사라지고, 날것 텍스트로 두면 본문과 구분되지 않는다.
 *
 * @param pipeSafe 표 셀용 escape(`|` 자리표시자)를 거친 텍스트를 돌려주는 함수
 */
export function renderEquation(
  script: string,
  pipeSafe: (text: string) => string,
): RenderedEquation | null {
  const source = script.trim();
  if (!source) return null;
  const latex = convert(source);
  if (latex) {
    return {
      html: rawMarkdownHtml(`$${neutralizeMarkdown(neutralizePipes(latex))}$`),
      fallback: false,
    };
  }
  return {
    html: `<code>${pipeSafe(escapeHtml(collapseWhitespace(source)))}</code>`,
    fallback: true,
  };
}
