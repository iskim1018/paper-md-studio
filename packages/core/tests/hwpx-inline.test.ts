import { describe, expect, it } from "vitest";
import {
  paragraph,
  parseHwpx,
  prefixSection,
  tableSection,
} from "./helpers/hwpx-fixture.js";

/**
 * `<hp:t>` 안쪽 텍스트 처리 회귀 테스트.
 *
 * 원인은 하나였다 — fast-xml-parser 기본값이 텍스트 조각마다 앞뒤 공백을
 * 깎고(trimValues), 숫자처럼 보이는 텍스트를 숫자로 바꾸고(parseTagValue),
 * 혼합 내용(`글<hp:tab/>글`)의 자식 위치를 버렸다. 실물 파일은 전부
 * 접두사(hp:)가 붙어 있으므로 두 변형을 함께 검증한다.
 */
const VARIANTS: Array<[string, (xml: string) => string]> = [
  ["접두사 없음", (xml) => xml],
  ["hp: 접두사 + xmlns", prefixSection],
];

async function md(sectionXml: string): Promise<string> {
  const result = await parseHwpx(sectionXml);
  return result.markdown ?? "";
}

describe.each(VARIANTS)("HWPX 인라인 텍스트 (%s)", (_label, wrap) => {
  const convert = (xml: string) => md(wrap(xml));

  it("run 경계의 공백을 살린다 — '제21조와 ' + 굵은 '같은'", async () => {
    // Act
    const out = await convert(
      paragraph(
        '<run charPrIDRef="0"><t>제21조와 </t></run><run charPrIDRef="1"><t>같은</t></run>',
      ),
    );

    // Assert
    expect(out).toBe("제21조와 **같은**");
  });

  it("공백만 있는 run도 낱말 사이 공백으로 남긴다", async () => {
    const out = await convert(
      paragraph(
        '<run charPrIDRef="0"><t>A</t></run><run charPrIDRef="0"><t> </t></run><run charPrIDRef="0"><t>B</t></run>',
      ),
    );

    expect(out).toBe("A B");
  });

  it("굵은 공백 run이 끼어도 낱말이 붙지 않는다", async () => {
    const out = await convert(
      paragraph(
        '<run charPrIDRef="0"><t>A</t></run><run charPrIDRef="1"><t> </t></run><run charPrIDRef="0"><t>B</t></run>',
      ),
    );

    expect(out).toBe("A B");
  });

  it("탭은 공백 하나로 남는다", async () => {
    const out = await convert(
      paragraph(
        '<run><t>관리<tab width="4000" leader="0" type="1"/>45</t></run>',
      ),
    );

    expect(out).toBe("관리 45");
  });

  it("채움선 탭(leader≠0)은 ' — '로 바꿔 쪽 번호를 살린다", async () => {
    const out = await convert(
      paragraph(
        '<run><t>제1장 총칙<tab width="4000" leader="3" type="2"/>12</t></run>',
      ),
    );

    expect(out).toBe("제1장 총칙 — 12");
  });

  it("문단 안 줄바꿈은 하드 브레이크가 된다", async () => {
    const out = await convert(
      paragraph("<run><t>첫 줄<lineBreak/>둘째 줄</t></run>"),
    );

    expect(out).toBe("첫 줄  \n둘째 줄");
  });

  it("표 셀 안 줄바꿈은 <br>로 남아 표가 깨지지 않는다", async () => {
    const out = await convert(
      tableSection(["<p><run><t>첫 줄<lineBreak/>둘째 줄</t></run></p>"]),
    );

    expect(out).toContain("| 첫 줄<br>둘째 줄 |");
  });

  it("제목 안 줄바꿈은 공백이 된다 — 제목 줄이 끊기지 않게", async () => {
    const out = await convert(
      paragraph("<run><t>큰<lineBreak/>제목</t></run>", 'styleIDRef="1"'),
    );

    expect(out).toBe("# 큰 제목");
  });

  it.each([
    ["1."],
    ["3.0"],
    ["007"],
    ["1e3"],
    ["0x1F"],
    ["1.50"],
  ])("숫자처럼 보이는 텍스트 %s를 바꾸지 않는다", async (value) => {
    const out = await convert(
      tableSection([`<p><run><t>${value}</t></run></p>`]),
    );

    expect(out).toContain(`| ${value} |`);
  });

  it("숫자 문자 참조와 XML 엔티티를 디코딩한다", async () => {
    const out = await convert(
      paragraph("<run><t>&#x41;&#44032; A &lt; B &amp; C &gt; D</t></run>"),
    );

    expect(out).toBe("A가 A < B & C > D");
  });

  it("고정폭 빈칸·묶음 빈칸은 공백이 된다", async () => {
    const out = await convert(
      paragraph("<run><t>가<fwSpace/>나 A-1<nbSpace/>다</t></run>"),
    );

    expect(out).toBe("가 나 A-1 다");
  });

  it("소프트 하이픈(hyphen)은 지운다", async () => {
    const out = await convert(paragraph("<run><t>가<hyphen/>나</t></run>"));

    expect(out).toBe("가나");
  });

  it("형광펜·제목 표시·삽입 표시는 무시하고 글자는 남긴다", async () => {
    const out = await convert(
      paragraph(
        '<run><t><markpenBegin color="#FFFF00"/>강조<markpenEnd/><titleMark ignore="0"/> 앞<insertBegin Id="1"/>삽입<insertEnd Id="1"/>뒤</t></run>',
      ),
    );

    expect(out).toBe("강조 앞삽입뒤");
  });

  it("변경 추적 삭제 구간의 글자는 빼고 경고를 남긴다", async () => {
    const result = await parseHwpx(
      wrap(
        paragraph(
          '<run><t>남김<deleteBegin Id="1"/>지움<deleteEnd Id="1"/>끝</t></run>',
        ),
      ),
    );

    expect(result.markdown).toBe("남김끝");
    expect(result.warnings).toContain(
      "변경 내용 추적으로 삭제 표시된 텍스트 1곳을 제외했습니다.",
    );
  });

  it("삭제 구간은 run과 문단 경계를 넘어 이어진다", async () => {
    const out = await convert(
      `<sec>
        <p styleIDRef="0"><run><t>가<deleteBegin Id="1"/>나</t></run><run><t>다</t></run></p>
        <p styleIDRef="0"><run><t>라<deleteEnd Id="1"/>마</t></run></p>
      </sec>`,
    );

    expect(out).toBe("가\n\n마");
  });

  it("ctrl 안의 삭제 표시도 같은 규칙으로 처리한다", async () => {
    const out = await convert(
      paragraph(
        '<run><t>가</t><ctrl><deleteBegin Id="1"/></ctrl><t>나</t><ctrl><deleteEnd Id="1"/></ctrl><t>다</t></run>',
      ),
    );

    expect(out).toBe("가다");
  });

  it("PUA 기호를 표준 유니코드로 바꾼다 (U+F06E, U+F02B1)", async () => {
    const out = await convert(
      paragraph("<run><t>\u{F06E} 체크 \u{F02B1} 하나</t></run>"),
    );

    expect(out).toBe("■ 체크 ① 하나");
  });

  it("개체 대체 문자(U+FFFC)는 지운다", async () => {
    const out = await convert(paragraph("<run><t>가\u{FFFC}나</t></run>"));

    expect(out).toBe("가나");
  });

  it("셀 안 '|'는 정확히 한 번만 escape되어 열 수가 유지된다", async () => {
    const out = await convert(
      tableSection([
        "<p><run><t>a | b</t></run></p>",
        "<p><run><t>c</t></run></p>",
      ]),
    );

    expect(out).toContain("| a \\| b | c |");
    expect(out).not.toContain("\\\\|");
  });
});

describe("HWPX 인라인 — 경고 없음", () => {
  it("평범한 문서는 warnings를 내지 않는다", async () => {
    const result = await parseHwpx(paragraph("<run><t>평범한 글</t></run>"));

    expect(result.warnings).toBeUndefined();
  });

  it("뷰어용 html에는 '|' 자리표시자가 남지 않는다", async () => {
    const result = await parseHwpx(
      tableSection(["<p><run><t>a | b</t></run></p>"]),
    );

    expect(result.html).toContain("a | b");
    expect(result.html).not.toContain("\u{E000}");
  });
});
