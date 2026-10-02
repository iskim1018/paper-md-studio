import { describe, expect, it } from "vitest";
import { parseSharedStrings } from "../src/parsers/xlsx/workbook.js";

/**
 * 공유 문자열(xl/sharedStrings.xml) 해석.
 *
 * 엑셀 텍스트 셀은 대부분 여기에 저장된다. 셀 일부에만 굵게·색을 입히면 문자열이
 * 서식 런(`<r><t>…</t></r>`)으로 쪼개지는데, 런 경계의 공백·줄바꿈과 "1." 같은
 * 조각을 XML 파서가 다듬거나 숫자로 바꾸면 원문이 조용히 망가진다.
 *
 * 픽스처는 합성 XML이다 (비공개 문서 발췌 금지).
 */
const sst = (items: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${items}</sst>`;

describe("parseSharedStrings", () => {
  it("숫자처럼 생긴 문자열을 그대로 둔다", () => {
    const result = parseSharedStrings(
      sst("<si><t>007</t></si><si><t>1.50</t></si><si><t>1e3</t></si>"),
    );
    expect(result).toEqual(["007", "1.50", "1e3"]);
  });

  it("xml:space=preserve 공백을 살린다", () => {
    const result = parseSharedStrings(
      sst('<si><t xml:space="preserve">  앞뒤 공백  </t></si>'),
    );
    expect(result).toEqual(["  앞뒤 공백  "]);
  });

  it("서식 런 경계의 공백·줄바꿈·숫자 조각을 보존한다", () => {
    const result = parseSharedStrings(
      sst(
        '<si><r><t>1.</t></r><r><t xml:space="preserve"> 첫째</t></r><r><t xml:space="preserve">\n</t></r><r><t>2. 둘째</t></r></si>' +
          '<si><r><t>AI</t></r><r><t xml:space="preserve"> </t></r><r><t>서비스</t></r></si>',
      ),
    );
    expect(result).toEqual(["1. 첫째\n2. 둘째", "AI 서비스"]);
  });

  it("항목 사이 들여쓰기 공백은 문자열에 섞이지 않는다", () => {
    const result = parseSharedStrings(
      sst(
        "\n  <si>\n    <t>가</t>\n  </si>\n  <si><r><t>나</t></r>\n  </si>\n",
      ),
    );
    expect(result).toEqual(["가", "나"]);
  });
});
