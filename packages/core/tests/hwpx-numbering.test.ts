import { describe, expect, it } from "vitest";
import { formatHeadNumber } from "../src/parsers/hwpx/numbering.js";
import {
  parseHwpx,
  prefixHeader,
  prefixSection,
  tableSection,
} from "./helpers/hwpx-fixture.js";

/**
 * 문단 머리(글머리표·문단 번호) 테스트.
 *
 * 한글은 기호·번호를 본문 글자로 저장하지 않고 header.xml의 정의
 * (paraPr > heading → bullets / numberings > paraHead)로만 그린다. 그래서
 * 정의를 읽지 않으면 "• 항목", "1. 개요"의 기호가 통째로 사라진다.
 */
const NUMBERING_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
      <style id="3" name="나열" />
    </styles>
    <charProperties>
      <charPr id="0" />
    </charProperties>
    <numberings>
      <numbering id="1" start="0">
        <paraHead start="1" level="1" numFormat="DIGIT">^1.</paraHead>
        <paraHead start="1" level="2" numFormat="HANGUL_SYLLABLE">^2.</paraHead>
        <paraHead start="1" level="3" numFormat="DIGIT">^3)</paraHead>
        <paraHead start="1" level="4" numFormat="CIRCLED_DIGIT">^4</paraHead>
        <paraHead start="1" level="5" numFormat="DIGIT"/>
        <paraHead start="1" level="6" numFormat="DIGIT">^1.^2.^6</paraHead>
      </numbering>
      <numbering id="2" start="1">
        <paraHead start="3" level="1" numFormat="ROMAN_CAPITAL">^1.</paraHead>
      </numbering>
    </numberings>
    <bullets>
      <bullet id="1" char="\u{F09F}" useImage="0"><paraHead level="0" numFormat="DIGIT"/></bullet>
      <bullet id="2" char="-" useImage="0"/>
      <bullet id="3" char="\u{AD}" useImage="0"/>
      <bullet id="4" char="\u{F0E0}" useImage="0"/>
    </bullets>
    <paraProperties>
      <paraPr id="0"><heading type="NONE" idRef="0" level="0"/></paraPr>
      <paraPr id="10"><heading type="NUMBER" idRef="1" level="0"/></paraPr>
      <paraPr id="11"><heading type="NUMBER" idRef="1" level="1"/></paraPr>
      <paraPr id="12"><heading type="NUMBER" idRef="1" level="2"/></paraPr>
      <paraPr id="13"><heading type="NUMBER" idRef="1" level="3"/></paraPr>
      <paraPr id="14"><heading type="NUMBER" idRef="1" level="4"/></paraPr>
      <paraPr id="15"><heading type="NUMBER" idRef="1" level="5"/></paraPr>
      <paraPr id="20"><heading type="NUMBER" idRef="2" level="0"/></paraPr>
      <paraPr id="30"><heading type="BULLET" idRef="1" level="0"/></paraPr>
      <paraPr id="31"><heading type="BULLET" idRef="2" level="0"/></paraPr>
      <paraPr id="32"><heading type="BULLET" idRef="3" level="0"/></paraPr>
      <paraPr id="33"><heading type="BULLET" idRef="4" level="0"/></paraPr>
      <paraPr id="40"><heading type="OUTLINE" idRef="0" level="0"/></paraPr>
    </paraProperties>
  </refList>
</head>`;

function p(paraPr: string, text: string, style = "0"): string {
  return `<p paraPrIDRef="${paraPr}" styleIDRef="${style}"><run><t>${text}</t></run></p>`;
}

const VARIANTS: Array<[string, (s: string) => string, (h: string) => string]> =
  [
    ["접두사 없음", (s) => s, (h) => h],
    ["hp:/hh: 접두사 + xmlns", prefixSection, prefixHeader],
  ];

describe.each(VARIANTS)("HWPX 문단 머리 (%s)", (_label, wrapSec, wrapHead) => {
  const md = async (body: string) =>
    (
      await parseHwpx(wrapSec(`<sec>${body}</sec>`), {
        headerXml: wrapHead(NUMBERING_HEADER),
      })
    ).markdown ?? "";

  it("수준별 문단 번호를 매기고 상위 수준이 바뀌면 하위를 다시 센다", async () => {
    // Act
    const out = await md(
      [
        p("10", "개요"),
        p("11", "가항"),
        p("11", "나항"),
        p("12", "세부"),
        p("10", "둘째"),
        p("11", "다시"),
      ].join(""),
    );

    // Assert — "1\." 처럼 escape되지 않은 날것의 번호여야 한다
    expect(out).toBe(
      "1. 개요\n\n가. 가항\n\n나. 나항\n\n1) 세부\n\n2. 둘째\n\n가. 다시",
    );
  });

  it("원문자 형식과 여러 수준을 잇는 형식(^1.^2.^6)을 그린다", async () => {
    const out = await md(
      [p("10", "하나"), p("11", "가"), p("13", "원"), p("15", "깊은")].join(""),
    );

    expect(out).toContain("① 원");
    expect(out).toContain("1.가.1 깊은");
  });

  it("서식이 빈 수준(<paraHead/>)은 번호를 붙이지 않는다", async () => {
    const out = await md(p("14", "번호 없음"));

    expect(out).toBe("번호 없음");
  });

  it("시작 번호(start)와 로마 숫자 형식을 따른다", async () => {
    const out = await md([p("20", "셋"), p("20", "넷")].join(""));

    expect(out).toBe("III. 셋\n\nIV. 넷");
  });

  it("빈 번호 문단도 번호를 하나 소비한다 (한글 화면과 같게)", async () => {
    const out = await md([p("10", "a"), p("10", ""), p("10", "c")].join(""));

    expect(out).toBe("1. a\n\n3. c");
  });

  it("글머리표 문자를 붙이고 PUA는 표준 기호로 바꾼다", async () => {
    const out = await md(p("30", "점"));

    expect(out).toBe("• 점");
  });

  it("'-' 글머리표는 escape하지 않고 그대로 낸다", async () => {
    const out = await md(p("31", "줄표"));

    expect(out).toBe("- 줄표");
  });

  it("소프트 하이픈(U+00AD) 글머리표는 '-'로 낸다", async () => {
    const out = await md(p("32", "소프트"));

    expect(out).toBe("- 소프트");
  });

  it("매핑에 없는 PUA 글머리표는 보이지 않는 글자 대신 '•'로 낸다", async () => {
    const out = await md(p("33", "미지"));

    expect(out).toBe("• 미지");
  });

  it("개요(OUTLINE) 문단은 구역의 outlineShapeIDRef 번호 체계를 쓴다", async () => {
    const out = await md(
      `<p paraPrIDRef="0" styleIDRef="0"><run><secPr outlineShapeIDRef="2"/><t>머리</t></run></p>${p("40", "개요 문단")}`,
    );

    expect(out).toBe("머리\n\nIII. 개요 문단");
  });

  it("셀 안 글머리표 문단도 기호를 유지한다", async () => {
    const result = await parseHwpx(
      wrapSec(
        tableSection([[p("30", "a"), p("30", "b"), p("30", "c")].join("")]),
      ),
      { headerXml: wrapHead(NUMBERING_HEADER) },
    );

    expect(result.markdown).toContain("| • a / • b / • c |");
  });

  it("'나열' 목록 문단에는 글머리표를 겹쳐 붙이지 않는다", async () => {
    const out = await md(p("30", "목록 항목", "3"));

    expect(out).toMatch(/^- {1,3}목록 항목$/);
  });
});

describe("formatHeadNumber", () => {
  it.each([
    [1, "DIGIT", "1"],
    [0, "DIGIT", "0"],
    [1, "HANGUL_SYLLABLE", "가"],
    [14, "HANGUL_SYLLABLE", "하"],
    [15, "HANGUL_SYLLABLE", "거"],
    [1, "HANGUL_JAMO", "ㄱ"],
    [14, "HANGUL_JAMO", "ㅎ"],
    [1, "CIRCLED_DIGIT", "①"],
    [20, "CIRCLED_DIGIT", "⑳"],
    [21, "CIRCLED_DIGIT", "㉑"],
    [1, "CIRCLED_HANGUL_SYLLABLE", "㉮"],
    [1, "CIRCLED_HANGUL_JAMO", "㉠"],
    [1, "LATIN_CAPITAL", "A"],
    [27, "LATIN_CAPITAL", "AA"],
    [2, "LATIN_SMALL", "b"],
    [2, "LATIN_UPPER", "B"],
    [3, "LATIN_LOWER", "c"],
    [4, "ROMAN_CAPITAL", "IV"],
    [9, "ROMAN_SMALL", "ix"],
    [14, "ROMAN_UPPER", "XIV"],
    [40, "ROMAN_LOWER", "xl"],
    [7, "UNKNOWN_FORMAT", "7"],
  ])("%i을 %s 형식으로 %s라 쓴다", (n, format, expected) => {
    expect(formatHeadNumber(n, format)).toBe(expected);
  });
});
