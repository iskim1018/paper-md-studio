import { beforeEach, describe, expect, it, vi } from "vitest";
import { hwpEquationToLatex } from "../src/parsers/hwp-equation/index.js";
import {
  paragraph,
  parseHwpx,
  prefixSection,
  tableSection,
  unescapedPipeCounts,
} from "./helpers/hwpx-fixture.js";

/**
 * 수식 → Markdown 배선 테스트.
 *
 * 변환기(`hwpEquationToLatex`) 자체는 별도 모듈이 맡는다. 여기서는 변환
 * 결과를 받은 뒤의 계약만 고정한다 — 인라인 `$…$`, turndown escape 차단,
 * 표 셀 안 "|" 무력화, 실패 시 코드 폴백 + 경고.
 */
vi.mock("../src/parsers/hwp-equation/index.js", () => ({
  hwpEquationToLatex: vi.fn(),
}));

const convertLatex = vi.mocked(hwpEquationToLatex);

function equation(script: string): string {
  return `<equation id="1" version="Equation Version 60"><script>${script}</script><shapeComment>수식입니다.</shapeComment></equation>`;
}

describe("HWPX 수식 렌더링", () => {
  beforeEach(() => {
    convertLatex.mockReset();
  });

  it("변환된 LaTeX를 escape 없이 인라인 $…$로 낸다", async () => {
    // Arrange
    convertLatex.mockReturnValue("\\frac{a_1}{2} * [x]");

    // Act
    const result = await parseHwpx(
      paragraph(
        `<run><t>값은 </t>${equation("{a_1} over 2 * [x]")}<t> 이다</t></run>`,
      ),
    );

    // Assert
    expect(result.markdown).toBe("값은 $\\frac{a_1}{2} * [x]$ 이다");
    expect(result.warnings).toBeUndefined();
    expect(convertLatex).toHaveBeenCalledWith("{a_1} over 2 * [x]");
  });

  it("접두사가 붙은 실물 모양 XML에서도 같은 결과를 낸다", async () => {
    convertLatex.mockReturnValue("x^2");

    const result = await parseHwpx(
      prefixSection(paragraph(`<run>${equation("x^2")}</run>`)),
    );

    expect(result.markdown).toBe("$x^2$");
  });

  it("여러 줄 LaTeX는 한 줄로 접는다 — 인라인 수식은 줄을 넘지 못한다", async () => {
    convertLatex.mockReturnValue("\\begin{matrix}\n a \\\\\n b\n\\end{matrix}");

    const result = await parseHwpx(
      paragraph(`<run>${equation("matrix{a#b}")}</run>`),
    );

    expect(result.markdown).toBe("$\\begin{matrix} a \\\\ b \\end{matrix}$");
  });

  it("표 셀 안 LaTeX의 '|'·'\\|'는 \\vert·\\Vert로 바꿔 열 구분자와 겹치지 않게 한다", async () => {
    convertLatex.mockReturnValue("\\left| x \\right| + \\|y\\|");

    const result = await parseHwpx(
      tableSection([
        `<p><run>${equation("LEFT | x RIGHT |")}</run></p>`,
        "<p><run><t>옆</t></run></p>",
      ]),
    );

    const out = result.markdown ?? "";
    expect(out).toContain(
      "| $\\left\\vert x \\right\\vert + \\Vert y\\Vert$ | 옆 |",
    );
    expect(new Set(unescapedPipeCounts(out))).toEqual(new Set([3]));
  });

  it("변환기가 null을 주면 원본 스크립트를 인라인 코드로 남기고 개수를 경고한다", async () => {
    convertLatex.mockReturnValue(null);

    const result = await parseHwpx(
      `<sec>
        <p styleIDRef="0"><run>${equation("a over b")}</run></p>
        <p styleIDRef="0"><run>${equation("c   over\n d")}</run></p>
      </sec>`,
    );

    expect(result.markdown).toBe("`a over b`\n\n`c over d`");
    expect(result.warnings).toEqual([
      "수식 2개는 LaTeX로 바꾸지 못해 원본 수식 스크립트를 코드로 남겼습니다.",
    ]);
  });

  it("변환기가 예외를 던져도 문서 전체가 실패하지 않고 코드로 남는다", async () => {
    convertLatex.mockImplementation(() => {
      throw new Error("변환 실패");
    });

    const result = await parseHwpx(
      paragraph(`<run>${equation("a over b")}</run>`),
    );

    expect(result.markdown).toBe("`a over b`");
    expect(result.warnings).toHaveLength(1);
  });

  it("빈 스크립트 수식은 아무것도 내지 않는다", async () => {
    const result = await parseHwpx(
      paragraph(`<run><t>앞</t>${equation("")}<t>뒤</t></run>`),
    );

    expect(result.markdown).toBe("앞뒤");
    expect(convertLatex).not.toHaveBeenCalled();
  });
});
