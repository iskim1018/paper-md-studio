import { describe, expect, it } from "vitest";
import { paragraph, parseHwpx, prefixSection } from "./helpers/hwpx-fixture.js";

/**
 * 변경 추적 삭제 구간(#13).
 *
 * OWPML 에서 삭제 구간은 `<hp:t>` 안의 deleteBegin…deleteEnd 로 표시되고, 그
 * 사이의 그림·수식·표·각주·링크·글상자는 run 의 형제 요소로 놓인다. 종전엔
 * 글자 토큰만 뺐기 때문에 지운 그림이 추출되고 지운 링크는 주소가 글자로
 * 새로 생겨났다.
 */

/** 1×1 투명 PNG */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00,
  0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const VARIANTS: Array<[string, (xml: string) => string]> = [
  ["접두사 없음", (xml) => xml],
  ["hp: 접두사 + xmlns", prefixSection],
];

const DELETED_WARNING =
  "변경 내용 추적으로 삭제 표시된 텍스트 1곳을 제외했습니다.";

function hyperlink(url: string, text: string): string {
  return `<ctrl><fieldBegin id="7" type="HYPERLINK" name=""><parameters cnt="1" name=""><stringParam name="Path">${url}</stringParam></parameters></fieldBegin></ctrl><t>${text}</t><ctrl><fieldEnd beginIDRef="7"/></ctrl>`;
}

const TABLE =
  "<tbl><tr><tc><subList><p><run><t>표 칸</t></run></p></subList></tc></tr></tbl>";
const TEXT_BOX =
  '<rect id="1"><drawText><subList><p styleIDRef="0"><run><t>글상자</t></run></p></subList></drawText></rect>';
const NOTE =
  '<ctrl><footNote number="1"><subList><p><run><t>각주 글</t></run></p></subList></footNote></ctrl>';

describe.each(VARIANTS)("HWPX 변경 추적 삭제 (%s)", (_label, wrap) => {
  const parse = (xml: string) =>
    parseHwpx(wrap(xml), { extraFiles: { "BinData/image1.png": PNG } });

  it("삭제 구간 안의 수식·그림·링크·표·글상자·각주를 모두 뺀다", async () => {
    // Act
    const result = await parse(
      paragraph(
        `<run><t>가<deleteBegin Id="1"/>삭제</t><equation><script>a+b</script></equation><pic><img binaryItemIDRef="image1"/></pic>${hyperlink("https://deleted.example", "지운링크")}${TABLE}${TEXT_BOX}${NOTE}<t>더<deleteEnd Id="1"/>다</t></run>`,
      ),
    );

    // Assert
    expect(result.markdown).toBe("가다");
    expect(result.images).toHaveLength(0);
    expect(result.warnings).toEqual([DELETED_WARNING]);
  });

  it("링크 하나만 지워도 주소가 글자로 새로 생기지 않는다", async () => {
    const result = await parse(
      paragraph(
        `<run><t>앞<deleteBegin Id="1"/></t>${hyperlink("https://deleted.example", "지운링크")}<t><deleteEnd Id="1"/>뒤</t></run>`,
      ),
    );

    expect(result.markdown).toBe("앞뒤");
  });

  it("링크는 남고 글자만 지워졌으면 빈 링크 대신 아무것도 내지 않는다", async () => {
    const result = await parse(
      paragraph(
        `<run><t>앞</t>${hyperlink("https://kept.example", '<deleteBegin Id="1"/>지운 글<deleteEnd Id="1"/>')}<t>뒤</t></run>`,
      ),
    );

    expect(result.markdown).toBe("앞뒤");
  });

  it("삭제가 뒤에서 시작돼도 그 앞에 놓인 표의 칸 글자는 남는다", async () => {
    const result = await parse(
      `<sec>
        <p styleIDRef="0"><run>${TABLE}<t>가<deleteBegin Id="1"/>나</t></run></p>
        <p styleIDRef="0"><run><t>다<deleteEnd Id="1"/>라</t></run></p>
      </sec>`,
    );

    expect(result.markdown).toBe("| 표 칸 |\n| --- |\n\n가\n\n라");
  });

  it("덧말·글자 겹치기·자동 번호도 삭제 구간이면 뺀다", async () => {
    const result = await parse(
      paragraph(
        '<run><t>가<deleteBegin Id="1"/></t><dutmal><mainText>본문</mainText><subText>덧말</subText></dutmal><compose composeText="21"/><ctrl><autoNum num="1" numType="TABLE"/></ctrl><t><deleteEnd Id="1"/>다</t></run>',
      ),
    );

    expect(result.markdown).toBe("가다");
  });
});
