import { describe, expect, it } from "vitest";
import {
  paragraph,
  parseHwpx,
  prefixSection,
  tableSection,
} from "./helpers/hwpx-fixture.js";

/**
 * 캡션과 자동 번호 테스트.
 *
 * OWPML 에서 캡션은 표만의 것이 아니다 — 그림·그리기 개체·수식·묶음 개체가
 * 모두 `<hp:caption><hp:subList><hp:p>`를 가질 수 있고, 한글의 "캡션 넣기"는
 * 번호를 글자가 아니라 `<hp:autoNum numType="TABLE|PICTURE|EQUATION">`으로
 * 저장한다. 둘 중 하나라도 버리면 "그림 1. 조직도"가 사라지거나 "표 . 예산"이 된다.
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

function autoNum(
  num: string | null,
  numType: string,
  format = "DIGIT",
  prefix = "",
  suffix = "",
): string {
  const numAttr = num === null ? "" : ` num="${num}"`;
  return `<ctrl><autoNum${numAttr} numType="${numType}"><autoNumFormat type="${format}" userChar="" prefixChar="${prefix}" suffixChar="${suffix}" supscript="0"/></autoNum></ctrl>`;
}

function caption(side: string, runs: string): string {
  return `<caption side="${side}"><subList><p styleIDRef="0"><run>${runs}</run></p></subList></caption>`;
}

const PIC = (cap: string) => `<pic>${cap}<img binaryItemIDRef="image1"/></pic>`;
const IMAGE_REF = /!\[[^\]]*\]\(\.\/doc_images\/img_001\.png\)/;

describe.each(VARIANTS)("HWPX 캡션·자동 번호 (%s)", (_label, wrap) => {
  const parse = (xml: string) =>
    parseHwpx(wrap(xml), { extraFiles: { "BinData/image1.png": PNG } });
  const md = async (xml: string) => (await parse(xml)).markdown ?? "";

  describe("자동 번호 (#6)", () => {
    it("표 캡션의 번호를 살린다 — '표 . 예산'이 아니라 '표 3. 예산'", async () => {
      // Act
      const out = await md(
        `<sec><p styleIDRef="0"><run><tbl>${caption("TOP", `<t>표 </t>${autoNum("3", "TABLE")}<t>. 예산</t>`)}<tr><tc><subList><p><run><t>가</t></run></p></subList></tc></tr></tbl></run></p></sec>`,
      );

      // Assert
      expect(out).toBe("표 3. 예산\n\n| 가 |\n| --- |");
    });

    it("번호 서식(autoNumFormat type)과 앞뒤 문자를 따른다", async () => {
      const out = await md(
        paragraph(
          `<run><t>그림 </t>${autoNum("2", "PICTURE", "ROMAN_SMALL")}<t> 구조, 식 </t>${autoNum("4", "EQUATION", "DIGIT", "(", ")")}</run>`,
        ),
      );

      expect(out).toBe("그림 ii 구조, 식 (4)");
    });

    it("num이 없으면 종류별로 차례대로 센다", async () => {
      const out = await md(
        `<sec>
          <p styleIDRef="0"><run><t>표 </t>${autoNum(null, "TABLE")}</run></p>
          <p styleIDRef="0"><run><t>표 </t>${autoNum(null, "TABLE")}</run></p>
        </sec>`,
      );

      expect(out).toBe("표 1\n\n표 2");
    });

    it("쪽 번호·각주 번호 자동 번호는 본문에 넣지 않는다", async () => {
      const out = await md(
        paragraph(
          `<run><t>쪽 </t>${autoNum("7", "PAGE")}<t>끝</t>${autoNum("1", "FOOTNOTE")}</run>`,
        ),
      );

      expect(out).toBe("쪽 끝");
    });
  });

  describe("그림·그리기 개체·수식·묶음 개체의 캡션 (#7)", () => {
    it("그림 아래(BOTTOM) 캡션을 그림 뒤에 낸다", async () => {
      const result = await parse(
        paragraph(
          `<run>${PIC(caption("BOTTOM", `<t>그림 </t>${autoNum("1", "PICTURE")}<t>. 조직도</t>`))}</run>`,
        ),
      );

      const out = result.markdown ?? "";
      expect(out).toMatch(IMAGE_REF);
      expect(out.search(IMAGE_REF)).toBeLessThan(out.indexOf("그림 1. 조직도"));
      expect(result.warnings).toBeUndefined();
    });

    it("그림 위(TOP) 캡션은 그림 앞에 낸다", async () => {
      const out = await md(
        paragraph(`<run>${PIC(caption("TOP", "<t>위 캡션</t>"))}</run>`),
      );

      expect(out).toContain("위 캡션");
      expect(out.indexOf("위 캡션")).toBeLessThan(out.search(IMAGE_REF));
    });

    it("글상자와 캡션을 함께 가진 그리기 개체는 둘 다 낸다", async () => {
      const out = await md(
        paragraph(
          `<run><rect id="1">${caption("BOTTOM", "<t>도형 캡션</t>")}<drawText><subList><p styleIDRef="0"><run><t>글상자 본문</t></run></p></subList></drawText></rect></run>`,
        ),
      );

      expect(out).toBe("글상자 본문\n\n도형 캡션");
    });

    it("캡션만 있는 그리기 개체도 캡션을 낸다", async () => {
      const out = await md(
        paragraph(
          `<run><ellipse id="1">${caption("BOTTOM", "<t>타원 캡션</t>")}</ellipse></run>`,
        ),
      );

      expect(out).toBe("타원 캡션");
    });

    it("수식 캡션을 수식과 함께 낸다", async () => {
      const out = await md(
        paragraph(
          `<run><equation>${caption("BOTTOM", "<t>식 1</t>")}<script>{a} over {b}</script></equation></run>`,
        ),
      );

      expect(out).toBe("$\\frac{a}{b}$\n\n식 1");
    });

    it("묶음 개체(container)의 캡션도 낸다", async () => {
      const out = await md(
        paragraph(
          `<run><container>${caption("TOP", "<t>묶음 캡션</t>")}${PIC("")}</container></run>`,
        ),
      );

      expect(out).toContain("묶음 캡션");
      expect(out.indexOf("묶음 캡션")).toBeLessThan(out.search(IMAGE_REF));
    });

    it("표 셀 안 그림 캡션은 셀 글자로 들어간다", async () => {
      const out = await md(
        tableSection([
          `<p><run>${PIC(caption("BOTTOM", "<t>셀 그림 캡션</t>"))}</run></p>`,
        ]),
      );

      expect(out).toMatch(/^\| !\[[^\]]*\]\([^)]*\) 셀 그림 캡션 \|$/m);
    });
  });
});
