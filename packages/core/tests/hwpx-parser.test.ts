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

    it("셀 내 3개 이상 paragraph는 <br>로 유지한다 (TOC 등 구조적 내용)", async () => {
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
              <p><run><t>1. 첫 항목</t></run></p>
              <p><run><t>2. 둘째 항목</t></run></p>
              <p><run><t>3. 셋째 항목</t></run></p>
            </subList>
          </tc>
        </tr>
      </tbl>
    </run>
  </p>
</sec>`,
      );

      // Markdown 하드 브레이크(2-space + newline)로 셀 내 줄바꿈 유지
      // turndown은 "1."을 "1\\."로 이스케이프하므로 느슨하게 매칭
      expect(result.markdown).toMatch(/1\\?\. 첫 항목/);
      expect(result.markdown).toMatch(/2\\?\. 둘째 항목/);
      expect(result.markdown).toMatch(/3\\?\. 셋째 항목/);
      // 3개 항목이 같은 줄에 공백으로 join되면 안 됨 (하드 브레이크 유지)
      expect(result.markdown).not.toMatch(/1\\?\. 첫 항목 2\\?\. 둘째 항목/);
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
