import { describe, expect, it } from "vitest";
import { buildNumberFormats } from "../src/parsers/spreadsheet/cell-format.js";
import { parseWorksheet } from "../src/parsers/xlsx/worksheet.js";

/**
 * 워크시트 XML → 셀 격자.
 *
 * 텍스트를 다듬지 않도록(`trimValues: false`) 파서를 설정했으므로, 요소 사이에
 * 줄바꿈·들여쓰기를 넣는 생성기(엑셀 외 도구)의 XML에서도 값이 오염되지 않아야 한다.
 *
 * 픽스처는 합성 XML이다 (비공개 문서 발췌 금지).
 */
const STYLES = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>
</styleSheet>`;

describe("parseWorksheet", () => {
  it("들여쓰기된 XML에서도 셀 값이 공백으로 오염되지 않는다", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s">
        <v>0</v>
      </c>
      <c r="B1" t="inlineStr">
        <is><t>007</t></is>
      </c>
      <c r="C1" t="str"><v>1.50</v></c>
    </row>
    <row r="2">
      <c r="A2" s="1">
        <v>45000</v>
      </c>
      <c r="B2" t="b">
        <v>1</v>
      </c>
      <c r="C2"><v>1E-3</v></c>
    </row>
  </sheetData>
  <mergeCells count="0">
  </mergeCells>
</worksheet>`;

    const grid = parseWorksheet(
      xml,
      ["공유"],
      buildNumberFormats(STYLES),
      false,
    );

    expect(grid.cells).toEqual([
      ["공유", "007", "1.50"],
      ["2023-03-15", "TRUE", "0.001"],
    ]);
  });
});
