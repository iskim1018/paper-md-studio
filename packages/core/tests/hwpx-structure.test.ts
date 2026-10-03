import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HwpxParser } from "../src/parsers/hwpx-parser.js";
import { convert } from "../src/pipeline.js";
import { nodesOfType, parseMarkdown } from "./helpers/commonmark.js";
import {
  buildHwpx,
  paragraph,
  parseHwpx,
  prefixSection,
  tableSection,
  unescapedPipeCounts,
} from "./helpers/hwpx-fixture.js";

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

const SMALL_TABLE =
  "<tbl><tr><tc><subList><p><run><t>칸1</t></run></p></subList></tc><tc><subList><p><run><t>칸2</t></run></p></subList></tc></tr></tbl>";

function textBox(body: string): string {
  return `<rect id="1"><drawText lastWidth="100"><subList>${body}</subList></drawText></rect>`;
}

function hyperlink(command: string, text: string): string {
  return `<ctrl><fieldBegin id="7" type="HYPERLINK" name=""><parameters cnt="1" name=""><stringParam name="Command">${command}</stringParam></parameters></fieldBegin></ctrl><t>${text}</t><ctrl><fieldEnd beginIDRef="7"/></ctrl>`;
}

describe.each(VARIANTS)("HWPX 문서 순서·누락 내용 (%s)", (_label, wrap) => {
  const parse = (xml: string, extraFiles?: Record<string, Uint8Array>) =>
    parseHwpx(wrap(xml), extraFiles ? { extraFiles } : undefined);
  const md = async (xml: string) => (await parse(xml)).markdown ?? "";

  describe("문서 순서", () => {
    it("같은 run에서 표 앞 글자는 표보다 먼저 나온다", async () => {
      // Act
      const out = await md(
        paragraph(`<run><t>표 앞 글</t>${SMALL_TABLE}<t>표 뒤 글</t></run>`),
      );

      // Assert
      const before = out.indexOf("표 앞 글");
      const table = out.indexOf("| 칸1");
      const after = out.indexOf("표 뒤 글");
      expect(before).toBeGreaterThanOrEqual(0);
      expect(before).toBeLessThan(table);
      expect(table).toBeLessThan(after);
    });

    it("셀 안에서도 글자 → 중첩 표 순서를 지킨다", async () => {
      const out = await md(
        tableSection([`<p><run><t>앞글</t>${SMALL_TABLE}</run></p>`]),
      );

      expect(out).toContain("| 앞글<br>(표 1×2)<br>칸1 · 칸2 |");
    });

    it("글자-수식-글자 순서를 지키고 수식은 LaTeX 로 낸다", async () => {
      // 변환 실패 시 코드로 남기는 대체 경로는 hwpx-equation-render.test.ts 가
      // 변환기를 모의해 따로 고정한다
      const result = await parse(
        paragraph(
          "<run><t>x는 </t><equation><script>{1} over\n  {2}</script><shapeComment>수식입니다.</shapeComment></equation><t> 이다</t></run>",
        ),
      );

      expect(result.markdown).toBe("x는 $\\frac{1}{2}$ 이다");
      expect(result.warnings ?? []).toEqual([]);
    });

    it("셀 안 수식 스크립트의 '|'는 표를 깨지 않는다", async () => {
      const out = await md(
        tableSection([
          "<p><run><equation><script>|x|</script></equation></run></p>",
          "<p><run><t>옆칸</t></run></p>",
        ]),
      );

      expect(out).toContain("| $\\vert x \\vert$ | 옆칸 |");
      expect(new Set(unescapedPipeCounts(out))).toEqual(new Set([3]));
    });
  });

  describe("글상자·묶음 개체", () => {
    it("글상자(drawText) 문단을 제자리에 본문 문단으로 낸다", async () => {
      const out = await md(
        `<sec>
          <p styleIDRef="0"><run><t>앞 문단</t></run></p>
          <p styleIDRef="0"><run>${textBox('<p styleIDRef="0"><run><t>상자 첫 줄</t></run></p><p styleIDRef="0"><run><t>상자 둘째 줄</t></run></p>')}</run></p>
          <p styleIDRef="0"><run><t>뒤 문단</t></run></p>
        </sec>`,
      );

      expect(out).toBe("앞 문단\n\n상자 첫 줄\n\n상자 둘째 줄\n\n뒤 문단");
    });

    it("셀 안 글상자 문단도 셀 내용으로 들어간다", async () => {
      const out = await md(
        tableSection([
          `<p><run>${textBox("<p><run><t>상자 글</t></run></p>")}</run></p>`,
        ]),
      );

      expect(out).toContain("| 상자 글 |");
    });

    it("묶음 개체(container) 안의 그림과 글상자를 모두 꺼낸다", async () => {
      const result = await parse(
        paragraph(
          `<run><container><pic><img binaryItemIDRef="image1"/></pic><container><pic><img binaryItemIDRef="image1"/></pic></container>${textBox("<p><run><t>묶음 속 글</t></run></p>")}</container></run>`,
        ),
        { "BinData/image1.png": PNG },
      );

      expect(result.images).toHaveLength(1);
      const refs = (result.markdown ?? "").match(
        /!\[[^\]]*\]\([^)]*img_001\.png\)/g,
      );
      expect(refs).toHaveLength(2);
      expect(result.markdown).toContain("묶음 속 글");
    });
  });

  describe("그림", () => {
    it("같은 그림을 여러 곳에서 참조하면 파일은 하나, 참조는 자리마다 남긴다", async () => {
      const result = await parse(
        `<sec>
          <p styleIDRef="0"><run><pic><img binaryItemIDRef="image1"/></pic></run></p>
          <p styleIDRef="0"><run><t>사이</t></run></p>
          <p styleIDRef="0"><run><pic><img binaryItemIDRef="image1"/></pic></run></p>
        </sec>`,
        { "BinData/image1.png": PNG },
      );

      expect(result.images).toHaveLength(1);
      expect((result.markdown ?? "").match(/img_001\.png/g)).toHaveLength(2);
    });

    it("WMF/EMF 그림은 조용히 버리지 않고 개수를 경고한다", async () => {
      const result = await parse(
        `<sec>
          <p styleIDRef="0"><run><pic><img binaryItemIDRef="image2"/></pic></run></p>
          <p styleIDRef="0"><run><pic><img binaryItemIDRef="image3"/></pic><t>본문</t></run></p>
        </sec>`,
        {
          "BinData/image2.wmf": new Uint8Array([1, 2, 3]),
          "BinData/image3.emf": new Uint8Array([1, 2, 3]),
        },
      );

      expect(result.images).toHaveLength(0);
      expect(result.warnings).toContain(
        "WMF/EMF 그림 2개는 변환할 수 없어 제외했습니다.",
      );
    });
  });

  describe("그림 이름 escape (#15)", () => {
    it("BinData 파일 이름의 따옴표로 img 속성이나 날것 Markdown을 끼워 넣지 못한다", async () => {
      // Arrange — 문서가 정한 ZIP 항목 이름이 그대로 alt 가 된다
      const name = 'x"><hwpx-md>[c](javascript:alert(1)) <img a=".png';
      const ref =
        "x&quot;&gt;&lt;hwpx-md&gt;[c](javascript:alert(1)) &lt;img a=&quot;";

      // Act
      const result = await parse(
        paragraph(`<run><pic><img binaryItemIDRef="${ref}"/></pic></run>`),
        { [`BinData/${name}`]: PNG },
      );

      // Assert
      expect(result.images).toHaveLength(1);
      expect(result.html).not.toMatch(/<img[^>]*\sa="/);
      expect(result.html).not.toContain("<hwpx-md");
      const tree = parseMarkdown(result.markdown ?? "");
      expect(nodesOfType(tree, "image")).toHaveLength(1);
      expect(nodesOfType(tree, "link")).toHaveLength(0);
    });
  });

  describe("표 캡션", () => {
    it("위쪽(TOP) 캡션은 표 앞에, 아래쪽(BOTTOM) 캡션은 표 뒤에 낸다", async () => {
      const caption = (side: string, text: string) =>
        `<caption side="${side}"><subList><p styleIDRef="0"><run><t>${text}</t></run></p></subList></caption>`;
      const out = await md(
        `<sec>
          <p styleIDRef="0"><run><tbl>${caption("TOP", "표 1. 위 캡션")}<tr><tc><subList><p><run><t>가</t></run></p></subList></tc></tr></tbl></run></p>
          <p styleIDRef="0"><run><tbl>${caption("BOTTOM", "아래 캡션")}<tr><tc><subList><p><run><t>나</t></run></p></subList></tc></tr></tbl></run></p>
        </sec>`,
      );

      expect(out.indexOf("표 1. 위 캡션")).toBeLessThan(out.indexOf("| 가"));
      expect(out.indexOf("| 나")).toBeLessThan(out.indexOf("아래 캡션"));
    });
  });

  describe("각주·미주", () => {
    const note = (tag: string, text: string) =>
      `<ctrl><${tag} number="1"><subList><p><run><ctrl><autoNum num="1" numType="FOOTNOTE"/></ctrl><t> </t></run><run><t>${text}</t></run></p></subList></${tag}></ctrl>`;

    it("각주 본문을 기준점 자리에 '(각주: …)'로 넣는다", async () => {
      const out = await md(
        paragraph(
          `<run><t>본문이다.</t>${note("footNote", "각주 내용")}<t> 계속</t></run>`,
        ),
      );

      expect(out).toBe("본문이다. (각주: 각주 내용) 계속");
    });

    it("미주는 '(미주: …)'로 넣는다", async () => {
      const out = await md(
        paragraph(`<run><t>본문</t>${note("endNote", "미주 내용")}</run>`),
      );

      expect(out).toBe("본문 (미주: 미주 내용)");
    });

    it("머리말·꼬리말은 본문에 넣지 않는다", async () => {
      const out = await md(
        paragraph(
          '<run><ctrl><header applyPageType="BOTH"><subList><p><run><t>머리말 글</t></run></p></subList></header></ctrl><ctrl><footer applyPageType="BOTH"><subList><p><run><t>꼬리말 글</t></run></p></subList></footer></ctrl><t>본문</t></run>',
        ),
      );

      expect(out).toBe("본문");
    });

    it("셀 안 각주의 '|'도 한 번만 escape되어 표가 깨지지 않는다", async () => {
      const out = await md(
        tableSection([
          `<p><run><t>값</t>${note("footNote", "a | b")}</run></p>`,
          "<p><run><t>옆</t></run></p>",
        ]),
      );

      expect(out).toContain("| 값 (각주: a \\| b) | 옆 |");
      expect(new Set(unescapedPipeCounts(out))).toEqual(new Set([3]));
    });
  });

  describe("호환용 분기(switch)·비표준 위치", () => {
    it("<switch>는 default 쪽 내용을 쓴다", async () => {
      const out = await md(
        paragraph(
          '<run><switch><case required-namespace="urn:x"><t>새 기능</t></case><default><t>대체 내용</t></default></switch></run>',
        ),
      );

      expect(out).toBe("대체 내용");
    });

    it("run에 직접 붙은 삭제 표시도 처리한다", async () => {
      const out = await md(
        paragraph(
          '<run><t>가</t><deleteBegin Id="1"/><t>나</t><deleteEnd Id="1"/><t>다</t></run>',
        ),
      );

      expect(out).toBe("가다");
    });
  });

  describe("하이퍼링크", () => {
    it("HYPERLINK 필드를 Markdown 링크로 낸다", async () => {
      const out = await md(
        paragraph(
          `<run><t>사이트(</t>${hyperlink("https\\://example.com/a_b?x=1;1;0;0;", "example.com")}<t>)</t></run>`,
        ),
      );

      expect(out).toBe("사이트([example.com](https://example.com/a_b?x=1))");
    });

    it("mailto 링크도 허용한다", async () => {
      const out = await md(
        paragraph(
          `<run>${hyperlink("mailto\\:a@example.com;1;0;0;", "메일")}</run>`,
        ),
      );

      expect(out).toBe("[메일](mailto:a@example.com)");
    });

    it("http(s)·mailto가 아닌 주소는 글자만 남긴다", async () => {
      const out = await md(
        paragraph(
          `<run>${hyperlink("javascript\\:alert(1);1;0;0;", "누르기")}</run>`,
        ),
      );

      expect(out).toBe("누르기");
    });

    it("하이퍼링크가 아닌 필드(누름틀·계산식)는 글자를 그대로 둔다", async () => {
      const out = await md(
        paragraph(
          '<run><ctrl><fieldBegin id="9" type="FORMULA" name=""><parameters cnt="1" name=""><stringParam name="Command">=SUM(A1)</stringParam></parameters></fieldBegin></ctrl><t>42</t><ctrl><fieldEnd beginIDRef="9"/></ctrl></run>',
        ),
      );

      expect(out).toBe("42");
    });

    it("셀 안 링크 주소의 '|'는 인코딩해 열 구분자와 겹치지 않는다", async () => {
      const out = await md(
        tableSection([
          `<p><run>${hyperlink("https\\://example.com/a|b;1;0;0;", "링크")}</run></p>`,
        ]),
      );

      expect(out).toContain("| [링크](https://example.com/a%7Cb) |");
    });

    it("주소의 백슬래시로 링크를 끊고 javascript: 링크를 잇지 못한다 (#16)", async () => {
      // Arrange — Path 그대로 넣는다 (Command 는 \\ 가 한 번 풀린다)
      const payload = "http://a.com/x\\)\\<javascript:alert%281%29//\\>";
      const field = `<ctrl><fieldBegin id="7" type="HYPERLINK" name=""><parameters cnt="1" name=""><stringParam name="Path">${payload.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</stringParam></parameters></fieldBegin></ctrl><t>click</t><ctrl><fieldEnd beginIDRef="7"/></ctrl>`;

      // Act
      const out = await md(paragraph(`<run>${field}</run>`));

      // Assert — 링크는 하나, 주소는 http, 백슬래시가 남지 않는다
      const links = nodesOfType(parseMarkdown(out), "link");
      expect(links).toHaveLength(1);
      expect(links[0]?.url).toMatch(/^http:\/\/a\.com\//);
      expect(links[0]?.url).not.toContain("\\");
      expect(out).not.toMatch(/\]\(javascript:/);
    });

    it("백슬래시가 섞인 http 주소는 브라우저처럼 '/'로 해석한다", async () => {
      const out = await md(
        paragraph(
          `<run>${hyperlink("http\\://a.com\\\\b\\\\c;1;0;0;", "링크")}</run>`,
        ),
      );

      expect(out).toBe("[링크](http://a.com/b/c)");
    });

    it("글자 없는 링크는 주소를 글자로 보인다", async () => {
      const out = await md(
        paragraph(
          `<run>${hyperlink("https\\://example.com;1;0;0;", "")}</run>`,
        ),
      );

      expect(out).toBe("[https://example.com](https://example.com)");
    });
  });
});

describe("HWPX 빈 문서와 바이트 입력", () => {
  const TEMP_DIR = resolve(import.meta.dirname, ".tmp-hwpx-structure");

  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it("본문이 없는 문서는 에러 대신 빈 결과와 경고를 돌려준다", async () => {
    // Act
    const result = await parseHwpx("<sec></sec>");

    // Assert
    expect(result.html).toBe("");
    expect(result.markdown).toBe("");
    expect(result.warnings?.[0]).toMatch(/^추출할 본문 텍스트가 없습니다/);
  });

  it("빈 문서도 convert()가 실패하지 않는다", async () => {
    const path = join(TEMP_DIR, "empty.hwpx");
    writeFileSync(path, buildHwpx("<sec></sec>"));

    const result = await convert({ inputPath: path });

    expect(result.markdown).toBe("");
    expect(result.warnings?.[0]).toMatch(/^추출할 본문 텍스트가 없습니다/);
  });

  it("parse(경로)와 parseBytes(바이트)는 같은 결과를 낸다", async () => {
    const bytes = buildHwpx(paragraph("<run><t>같은 결과</t></run>"));
    const path = join(TEMP_DIR, "same.hwpx");
    writeFileSync(path, bytes);
    const parser = new HwpxParser();

    const fromPath = await parser.parse(path, { imagesDirName: "x_images" });
    const fromBytes = await parser.parseBytes(bytes, {
      imagesDirName: "x_images",
    });

    expect(fromBytes).toEqual(fromPath);
    expect(fromBytes.markdown).toBe("같은 결과");
  });

  it("parseBytes는 옵션 없이도 동작한다", async () => {
    const result = await new HwpxParser().parseBytes(
      buildHwpx(paragraph("<run><t>옵션 없음</t></run>")),
    );

    expect(result.markdown).toBe("옵션 없음");
  });

  it("아주 큰 colSpan도 영어 RangeError 없이 열 상한까지만 펼친다 (#8)", async () => {
    const started = performance.now();

    const result = await parseHwpx(
      '<sec><p styleIDRef="0"><run><tbl><tr><tc><subList><p><run><t>칸</t></run></p></subList><cellSpan colSpan="1000000" rowSpan="1"/></tc></tr></tbl></run></p></sec>',
    );

    expect(result.markdown).toContain("칸");
    expect(new Set(unescapedPipeCounts(result.markdown ?? ""))).toEqual(
      new Set([257]),
    );
    expect(result.warnings?.[0]).toMatch(/^표 1개가 너무 커서/);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("ZIP이 아닌 바이트는 한국어 에러를 던진다", async () => {
    await expect(
      new HwpxParser().parseBytes(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toThrow(/HWPX 파일을 열 수 없습니다/);
  });
});
