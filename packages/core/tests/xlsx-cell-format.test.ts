import { describe, expect, it } from "vitest";
import {
  buildNumberFormats,
  classifyFormat,
  formatCellValue,
} from "../src/parsers/spreadsheet/cell-format.js";

/**
 * 엑셀은 셀에 "값"만 저장하고 사람이 보는 표시형식은 styles.xml에 따로 둔다.
 * 그래서 서식을 해석하지 않으면 2023-03-15가 45000으로, 15.7%가 0.157로 나온다.
 * 이 모듈이 numFmt를 해석해 사람이 읽을 수 있는 문자열로 되돌린다.
 */
describe("classifyFormat", () => {
  it("내장 날짜 서식 ID를 date로 분류한다", () => {
    expect(classifyFormat(14, new Map())).toBe("date");
    expect(classifyFormat(15, new Map())).toBe("date");
  });

  it("내장 날짜+시각 서식 ID를 datetime으로 분류한다", () => {
    expect(classifyFormat(22, new Map())).toBe("datetime");
  });

  it("내장 백분율 서식 ID를 percent로 분류한다", () => {
    expect(classifyFormat(9, new Map())).toBe("percent");
    expect(classifyFormat(10, new Map())).toBe("percent");
  });

  it("사용자 서식의 날짜 코드를 인식한다", () => {
    const custom = new Map([[176, "yyyy-mm-dd"]]);
    expect(classifyFormat(176, custom)).toBe("date");
  });

  it("사용자 서식의 시각 포함 코드는 datetime으로 본다", () => {
    const custom = new Map([[177, "yyyy-mm-dd hh:mm"]]);
    expect(classifyFormat(177, custom)).toBe("datetime");
  });

  it("따옴표 안의 문자는 날짜 코드로 오인하지 않는다", () => {
    // "date"라는 리터럴 텍스트가 d/a/t/e를 포함해도 날짜가 아니다
    const custom = new Map([[178, '"date"#,##0']]);
    expect(classifyFormat(178, custom)).toBe("number");
  });

  it("통화 기호가 붙은 사용자 서식은 number로 본다", () => {
    const custom = new Map([[164, '"₩"#,##0']]);
    expect(classifyFormat(164, custom)).toBe("number");
  });

  it("General은 일반으로 본다", () => {
    expect(classifyFormat(0, new Map())).toBe("general");
  });
});

describe("formatCellValue", () => {
  const noFmt = new Map<number, string>();

  it("날짜 시리얼을 ISO 날짜로 되돌린다", () => {
    // 45000 = 2023-03-15 (1900 날짜 체계)
    expect(formatCellValue("45000", 14, noFmt, false)).toBe("2023-03-15");
  });

  it("1900년 윤년 버그 구간(60 미만)을 보정한다", () => {
    // 엑셀은 존재하지 않는 1900-02-29를 시리얼 60으로 센다
    expect(formatCellValue("1", 14, noFmt, false)).toBe("1900-01-01");
  });

  it("1904 날짜 체계(맥 엑셀)를 지원한다", () => {
    expect(formatCellValue("0", 14, noFmt, true)).toBe("1904-01-01");
  });

  it("날짜+시각은 시각까지 남긴다", () => {
    // 45000.5 = 2023-03-15 12:00:00
    expect(formatCellValue("45000.5", 22, noFmt, false)).toBe(
      "2023-03-15 12:00:00",
    );
  });

  it("백분율을 사람이 읽는 형태로 바꾼다", () => {
    expect(formatCellValue("0.157", 10, noFmt, false)).toBe("15.70%");
    expect(formatCellValue("0.157", 9, noFmt, false)).toBe("16%");
  });

  it("천단위 구분과 통화 기호를 살린다", () => {
    const custom = new Map([[164, '"₩"#,##0']]);
    expect(formatCellValue("1234567", 164, custom, false)).toBe("₩1,234,567");
  });

  it("내장 천단위 서식을 적용한다", () => {
    expect(formatCellValue("9876543", 3, noFmt, false)).toBe("9,876,543");
  });

  it("소수 자릿수를 서식대로 맞춘다", () => {
    expect(formatCellValue("1234.5", 4, noFmt, false)).toBe("1,234.50");
  });

  it("General은 값을 그대로 둔다", () => {
    expect(formatCellValue("42", 0, noFmt, false)).toBe("42");
    expect(formatCellValue("3.14", 0, noFmt, false)).toBe("3.14");
  });

  it("숫자가 아니면 원본을 그대로 돌려준다", () => {
    expect(formatCellValue("해당없음", 14, noFmt, false)).toBe("해당없음");
  });

  it("날짜 범위를 벗어난 값은 원본을 유지한다", () => {
    expect(formatCellValue("-5", 14, noFmt, false)).toBe("-5");
  });
});

describe("buildNumberFormats", () => {
  it("styles.xml의 cellXfs 인덱스 → 서식 ID 맵을 만든다", () => {
    const xml = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₩&quot;#,##0"/></numFmts>
      <cellXfs count="3">
        <xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/>
      </cellXfs>
    </styleSheet>`;

    const { xfFormatIds, customFormats } = buildNumberFormats(xml);

    expect(xfFormatIds).toEqual([0, 14, 164]);
    expect(customFormats.get(164)).toBe('"₩"#,##0');
  });

  it("cellXfs가 없으면 빈 결과를 돌려준다", () => {
    const { xfFormatIds, customFormats } = buildNumberFormats(
      "<styleSheet></styleSheet>",
    );

    expect(xfFormatIds).toEqual([]);
    expect(customFormats.size).toBe(0);
  });
});
