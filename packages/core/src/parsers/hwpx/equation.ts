import { rawMarkdownHtml } from "../../html-to-md.js";
import { hwpEquationToLatex } from "../hwp-equation/index.js";
import { escapeHtml } from "./inline-builder.js";

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
      html: rawMarkdownHtml(`$${neutralizePipes(latex)}$`),
      fallback: false,
    };
  }
  return {
    html: `<code>${pipeSafe(escapeHtml(collapseWhitespace(source)))}</code>`,
    fallback: true,
  };
}
