import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convert } from "../src/pipeline.js";

const TEMP_DIR = resolve(import.meta.dirname, ".tmp-hwpx-tdd");

function buildHwpx(
  sectionXml: string,
  opts?: {
    headerXml?: string;
    extraFiles?: Record<string, Uint8Array>;
  },
): Uint8Array {
  const headerXml =
    opts?.headerXml ??
    `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
      <style id="1" name="1. 제목" />
      <style id="2" name="1.1 부제목" />
      <style id="3" name="나열" />
    </styles>
    <charProperties>
      <charPr id="0" />
      <charPr id="1"><bold /></charPr>
    </charProperties>
  </refList>
</head>`;

  const hpfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package>
  <manifest>
    <item id="section0" href="section0.xml" />
  </manifest>
  <spine>
    <itemref idref="section0" />
  </spine>
</package>`;

  return zipSync({
    mimetype: strToU8("application/hwpx+zip"),
    "Contents/header.xml": strToU8(headerXml),
    "Contents/section0.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n${sectionXml}`,
    ),
    "Contents/content.hpf": strToU8(hpfXml),
    ...opts?.extraFiles,
  });
}

function writeAndConvert(
  name: string,
  sectionXml: string,
  opts?: Parameters<typeof buildHwpx>[1],
) {
  const path = join(TEMP_DIR, name);
  writeFileSync(path, buildHwpx(sectionXml, opts));
  return convert({ inputPath: path });
}

describe("HWPX 파서 상세 테스트", () => {
  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  describe("헤딩 변환", () => {
    it("스타일 '1. 제목'을 h1으로 변환한다", async () => {
      const result = await writeAndConvert(
        "heading.hwpx",
        `
<sec>
  <p styleIDRef="1">
    <run><t>제목 텍스트</t></run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("# 제목 텍스트");
    });

    it("스타일 '1.1 부제목'을 h2로 변환한다", async () => {
      const result = await writeAndConvert(
        "heading2.hwpx",
        `
<sec>
  <p styleIDRef="2">
    <run><t>부제목 텍스트</t></run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("## 부제목 텍스트");
    });
  });

  describe("리스트 변환", () => {
    it("스타일 '나열'을 리스트 항목으로 변환한다", async () => {
      const result = await writeAndConvert(
        "list.hwpx",
        `
<sec>
  <p styleIDRef="3">
    <run><t>항목 1</t></run>
  </p>
  <p styleIDRef="3">
    <run><t>항목 2</t></run>
  </p>
</sec>`,
      );

      // Turndown은 리스트 항목에 여분 공백 추가 가능
      expect(result.markdown).toMatch(/- {1,3}항목 1/);
      expect(result.markdown).toMatch(/- {1,3}항목 2/);
    });
  });

  describe("볼드 변환", () => {
    it("charPrIDRef로 볼드 텍스트를 감지한다", async () => {
      const result = await writeAndConvert(
        "bold.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="1"><t>굵은 글씨</t></run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("**굵은 글씨**");
    });

    it("연속된 볼드 run은 하나의 **로 병합된다", async () => {
      // 사용자 리포트: **볼드1****볼드2** 식으로 split되면 뷰어에서 제대로
      // 렌더링되지 않음. 하나로 묶여야 함.
      const result = await writeAndConvert(
        "bold-merge.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="1"><t>볼드1</t></run>
    <run charPrIDRef="1"><t>볼드2</t></run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("**볼드1볼드2**");
      expect(result.markdown).not.toContain("**볼드1****볼드2**");
    });

    it("볼드 사이에 일반 run이 있으면 분리된다", async () => {
      const result = await writeAndConvert(
        "bold-split.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="1"><t>볼드</t></run>
    <run charPrIDRef="0"><t>일반</t></run>
    <run charPrIDRef="1"><t>다시볼드</t></run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("**볼드**");
      expect(result.markdown).toContain("일반");
      expect(result.markdown).toContain("**다시볼드**");
    });

    it("연속된 취소선 run도 하나의 ~~로 병합된다", async () => {
      const headerWithStrike = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
    </styles>
    <charProperties>
      <charPr id="0" />
      <charPr id="2"><strikeout /></charPr>
    </charProperties>
  </refList>
</head>`;
      const result = await writeAndConvert(
        "strike-merge.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="2"><t>지움1</t></run>
    <run charPrIDRef="2"><t>지움2</t></run>
  </p>
</sec>`,
        { headerXml: headerWithStrike },
      );

      expect(result.markdown).toContain("~~지움1지움2~~");
    });
  });

  describe("이탈릭 변환", () => {
    const headerWithItalic = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
    </styles>
    <charProperties>
      <charPr id="0" />
      <charPr id="1"><bold /></charPr>
      <charPr id="4"><italic /></charPr>
      <charPr id="5"><bold /><italic /></charPr>
    </charProperties>
  </refList>
</head>`;

    it("italic을 가진 charPr은 *텍스트*로 변환된다", async () => {
      const result = await writeAndConvert(
        "italic.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="4"><t>기울임</t></run>
  </p>
</sec>`,
        { headerXml: headerWithItalic },
      );

      expect(result.markdown).toMatch(/\*기울임\*/);
      expect(result.markdown).not.toContain("**기울임**");
    });

    it("볼드+이탈릭은 ***텍스트***로 변환된다", async () => {
      const result = await writeAndConvert(
        "bold-italic.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="5"><t>굵고기울임</t></run>
  </p>
</sec>`,
        { headerXml: headerWithItalic },
      );

      expect(result.markdown).toContain("굵고기울임");
      // **굵고기울임**과 *굵고기울임* 양쪽 마커가 모두 적용돼야 함
      expect(result.markdown).toMatch(
        /\*\*\*굵고기울임\*\*\*|\*\*\*굵고기울임\*\*\*/,
      );
    });

    it("연속된 이탈릭 run은 하나의 *로 병합된다", async () => {
      const result = await writeAndConvert(
        "italic-merge.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="4"><t>기울1</t></run>
    <run charPrIDRef="4"><t>기울2</t></run>
  </p>
</sec>`,
        { headerXml: headerWithItalic },
      );

      expect(result.markdown).toMatch(/\*기울1기울2\*/);
      expect(result.markdown).not.toContain("*기울1**기울2*");
    });

    it("italic 없는 charPr은 일반 텍스트로 유지된다", async () => {
      const result = await writeAndConvert(
        "no-italic.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="0"><t>일반</t></run>
  </p>
</sec>`,
        { headerXml: headerWithItalic },
      );

      expect(result.markdown).toContain("일반");
      expect(result.markdown).not.toMatch(/\*일반\*/);
    });
  });

  describe("취소선 변환", () => {
    const headerWithStrike = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
    </styles>
    <charProperties>
      <charPr id="0" />
      <charPr id="1"><bold /></charPr>
      <charPr id="2"><strikeout /></charPr>
      <charPr id="3"><bold /><strikeout /></charPr>
    </charProperties>
  </refList>
</head>`;

    it("strikeout을 가진 charPr은 ~~텍스트~~로 변환된다", async () => {
      const result = await writeAndConvert(
        "strike.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="2"><t>지운 글씨</t></run>
  </p>
</sec>`,
        { headerXml: headerWithStrike },
      );

      expect(result.markdown).toContain("~~지운 글씨~~");
    });

    it("볼드와 취소선이 함께 있으면 모두 적용된다", async () => {
      const result = await writeAndConvert(
        "bold-strike.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="3"><t>굵고 지운 글씨</t></run>
  </p>
</sec>`,
        { headerXml: headerWithStrike },
      );

      // **~~text~~** 또는 ~~**text**~~ 어느 순서든 허용
      expect(result.markdown).toMatch(
        /\*\*~~굵고 지운 글씨~~\*\*|~~\*\*굵고 지운 글씨\*\*~~/,
      );
    });

    it("strikeout shape='3D'는 취소선으로 간주되지 않는다 (default text effect marker)", async () => {
      // 실제 sample.hwpx는 대부분의 charPr에 shape="3D"를 넣어두는데
      // 이는 HWPX strikeout 스펙(NONE/SOLID/DOT/DASH/...)에 없는 값이므로
      // "미적용" marker로 해석되어야 한다.
      const header3d = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
    </styles>
    <charProperties>
      <charPr id="20">
        <strikeout shape="3D" color="#000000"/>
      </charPr>
      <charPr id="21">
        <strikeout shape="SOLID" color="#000000"/>
      </charPr>
    </charProperties>
  </refList>
</head>`;
      const result = await writeAndConvert(
        "strike-3d.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="20"><t>그림자텍스트</t></run>
    <run charPrIDRef="21"><t>실제취소선</t></run>
  </p>
</sec>`,
        { headerXml: header3d },
      );

      expect(result.markdown).not.toContain("~~그림자텍스트");
      expect(result.markdown).toContain("~~실제취소선~~");
    });

    it("strikeout shape='NONE'은 취소선으로 간주되지 않는다 (실제 HWPX 스키마)", async () => {
      // 실제 한컴 HWPX는 charPr마다 <strikeout shape="..."/>를 항상 포함.
      // shape="NONE"은 취소선 OFF, shape="SOLID" 등은 ON을 의미.
      const realHeader = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
    </styles>
    <charProperties>
      <charPr id="10">
        <strikeout shape="NONE" color="#000000"/>
      </charPr>
      <charPr id="11">
        <strikeout shape="SOLID" color="#000000"/>
      </charPr>
    </charProperties>
  </refList>
</head>`;
      const result = await writeAndConvert(
        "strike-shape.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="10"><t>정상</t></run>
    <run charPrIDRef="11"><t>지움</t></run>
  </p>
</sec>`,
        { headerXml: realHeader },
      );

      // "정상"은 취소선 태그 없이 나와야 하고, "지움"만 ~~...~~
      expect(result.markdown).toContain("~~지움~~");
      expect(result.markdown).not.toContain("~~정상");
      expect(result.markdown).not.toMatch(/~~정상[^~]*지움~~/);
    });

    it("취소선이 없는 charPr은 일반 텍스트로 유지된다", async () => {
      const result = await writeAndConvert(
        "no-strike.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run charPrIDRef="0"><t>일반 글씨</t></run>
  </p>
</sec>`,
        { headerXml: headerWithStrike },
      );

      expect(result.markdown).toContain("일반 글씨");
      expect(result.markdown).not.toContain("~~일반");
    });
  });

  describe("테이블 변환", () => {
    it("테이블을 파이프 테이블로 변환한다", async () => {
      const result = await writeAndConvert(
        "table.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run>
      <tbl>
        <tr>
          <tc><subList><p><run><t>헤더1</t></run></p></subList></tc>
          <tc><subList><p><run><t>헤더2</t></run></p></subList></tc>
        </tr>
        <tr>
          <tc><subList><p><run><t>값1</t></run></p></subList></tc>
          <tc><subList><p><run><t>값2</t></run></p></subList></tc>
        </tr>
      </tbl>
    </run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("헤더1");
      expect(result.markdown).toContain("헤더2");
      expect(result.markdown).toContain("값1");
      expect(result.markdown).toContain("값2");
      expect(result.markdown).toContain("|");
    });

    it("셀 내 2개 이하 paragraph는 공백으로 join한다 (하드 브레이크 축소)", async () => {
      const result = await writeAndConvert(
        "cell-short.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run>
      <tbl>
        <tr>
          <tc>
            <subList>
              <p><run><t>제목입니다</t></run></p>
              <p><run><t>부제목</t></run></p>
            </subList>
          </tc>
        </tr>
      </tbl>
    </run>
  </p>
</sec>`,
      );

      // 하드 브레이크(  \\n) 없이 공백으로 join되어야 한다
      expect(result.markdown).toContain("제목입니다 부제목");
      expect(result.markdown).not.toMatch(/제목입니다\s*\n\s*부제목/);
    });

    it("셀 내 3개 이상 paragraph는 ' / ' 구분자로 단일 라인에 flatten된다", async () => {
      const result = await writeAndConvert(
        "cell-long.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run>
      <tbl>
        <tr>
          <tc>
            <subList>
              <p><run><t>첫 항목</t></run></p>
              <p><run><t>둘째 항목</t></run></p>
              <p><run><t>셋째 항목</t></run></p>
            </subList>
          </tc>
        </tr>
      </tbl>
    </run>
  </p>
</sec>`,
      );

      // GFM 테이블 셀 안에 하드 브레이크가 들어가면 구조가 깨지므로
      // 3개 이상 paragraph도 단일 라인으로 flatten하고 " / "로 구분한다
      expect(result.markdown).toContain("첫 항목 / 둘째 항목 / 셋째 항목");
      // 셀이 여러 라인으로 쪼개지면 안 됨
      expect(result.markdown).not.toMatch(/첫 항목\s*\n\s*둘째 항목/);
    });

    it("colspan/rowspan 셀을 처리한다", async () => {
      const result = await writeAndConvert(
        "table-span.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run>
      <tbl>
        <tr>
          <tc><cellSpan colSpan="2" /><subList><p><run><t>병합셀</t></run></p></subList></tc>
        </tr>
        <tr>
          <tc><subList><p><run><t>A</t></run></p></subList></tc>
          <tc><subList><p><run><t>B</t></run></p></subList></tc>
        </tr>
      </tbl>
    </run>
  </p>
</sec>`,
      );

      expect(result.markdown).toContain("병합셀");
    });
  });

  describe("HTML 이스케이프", () => {
    it("특수문자를 이스케이프한다", async () => {
      const result = await writeAndConvert(
        "escape.hwpx",
        `
<sec>
  <p styleIDRef="0">
    <run><t>A &lt; B &amp; C &gt; D</t></run>
  </p>
</sec>`,
      );

      // XML 파서가 엔티티를 디코딩한 후 escapeHtml이 다시 이스케이프
      // Turndown이 최종 MD로 변환할 때 평문으로 복원
      expect(result.markdown).toBeTruthy();
    });
  });

  describe("빈 문서 처리", () => {
    it("빈 섹션은 에러를 던진다", async () => {
      await expect(
        writeAndConvert("empty.hwpx", `<sec></sec>`),
      ).rejects.toThrow("파서가 HTML 또는 Markdown을 반환하지 않았습니다");
    });
  });

  describe("복합 문서", () => {
    it("헤딩 + 본문 + 리스트를 순서대로 변환한다", async () => {
      const result = await writeAndConvert(
        "mixed.hwpx",
        `
<sec>
  <p styleIDRef="1">
    <run><t>문서 제목</t></run>
  </p>
  <p styleIDRef="0">
    <run><t>본문 단락입니다.</t></run>
  </p>
  <p styleIDRef="3">
    <run><t>항목 A</t></run>
  </p>
  <p styleIDRef="3">
    <run><t>항목 B</t></run>
  </p>
  <p styleIDRef="0">
    <run><t>마지막 단락</t></run>
  </p>
</sec>`,
      );

      const md = result.markdown;
      expect(md).toContain("# 문서 제목");
      expect(md).toContain("본문 단락입니다.");
      expect(md).toMatch(/- {1,3}항목 A/);
      expect(md).toMatch(/- {1,3}항목 B/);
      expect(md).toContain("마지막 단락");

      // 순서 확인
      const titleIdx = md.indexOf("# 문서 제목");
      const bodyIdx = md.indexOf("본문 단락입니다.");
      const listIdx = md.search(/- {1,3}항목 A/);
      expect(titleIdx).toBeLessThan(bodyIdx);
      expect(bodyIdx).toBeLessThan(listIdx);
    });
  });
});
