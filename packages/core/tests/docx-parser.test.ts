import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocxParser } from "../src/parsers/docx-parser.js";
import { MERGE_LEFT, MERGE_UP } from "../src/parsers/html-tables-to-gfm.js";

/**
 * DOCX 표 → GFM 계약 테스트.
 *
 * Word는 셀 병합을 gridSpan(가로)·vMerge(세로)로 저장하고, mammoth가 이를
 * colspan/rowspan HTML로 복원한다. 이 표가 HWPX/kordoc 경로와 같은 계약
 * (grid 정규화 + 병합 화살표 + 1행 1줄)의 GFM으로 내려가야 한다.
 *
 * 픽스처는 합성 OOXML이다 (비공개 문서 발췌 금지).
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * 3열 표:
 *   1행: [세로병합(2행), 가로병합(2열)]
 *   2행: [ (vMerge 연속) , 문단 2개 셀, 마지막]
 * 기대 grid:
 *   | 세로병합 | 가로병합 | ← |
 *   | ↑ | 첫문단<br>둘째문단 | 마지막 |
 */
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>표 앞 문단</w:t></w:r></w:p>
    <w:tbl>
      <w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:vMerge w:val="restart"/></w:tcPr>
          <w:p><w:r><w:t>세로병합</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:gridSpan w:val="2"/></w:tcPr>
          <w:p><w:r><w:t>가로병합</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:vMerge/></w:tcPr>
          <w:p/>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>첫문단</w:t></w:r></w:p>
          <w:p><w:r><w:t>둘째문단</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>마지막</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>표 뒤 문단</w:t></w:r></w:p>
  </w:body>
</w:document>`;

function buildDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "word/document.xml": strToU8(DOCUMENT_XML),
  });
}

describe("DocxParser 표 변환", () => {
  let tmpDir: string;
  let markdown: string;
  let html: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "docx-parser-test-"));
    const docxPath = join(tmpDir, "merged-table.docx");
    await writeFile(docxPath, buildDocx());

    const parser = new DocxParser();
    const result = await parser.parse(docxPath, {
      imagesDirName: "merged-table_images",
    });
    expect(result.markdown).not.toBeNull();
    expect(result.html).not.toBeNull();
    markdown = result.markdown as string;
    html = result.html as string;
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("표를 GFM으로 내린다 — HTML 표가 남지 않는다", () => {
    expect(markdown).not.toContain("<table");
    expect(markdown).toContain("| --- |");
  });

  it("가로 병합 연속 자리에 왼쪽 화살표를 남긴다", () => {
    expect(markdown).toContain(`| 가로병합 | ${MERGE_LEFT} |`);
  });

  it("세로 병합 연속 자리에 위쪽 화살표를 남긴다", () => {
    expect(markdown).toContain(`| ${MERGE_UP} |`);
  });

  it("문단 여러 개 셀은 <br>로 이어 1행 1줄을 지킨다", () => {
    expect(markdown).toContain("첫문단<br>둘째문단");

    const tableLines = markdown
      .split("\n")
      .filter((line) => line.startsWith("|"));
    // 헤더 + separator + 데이터 1행 = 3줄, 모든 행의 열 수는 3
    expect(tableLines).toHaveLength(3);
    for (const line of tableLines) {
      expect(line.split(/(?<!\\)\|/)).toHaveLength(5); // "| a | b | c |" → 5조각
    }
  });

  it("표 바깥 문단은 일반 Markdown으로 변환한다", () => {
    expect(markdown).toContain("표 앞 문단");
    expect(markdown).toContain("표 뒤 문단");
  });

  it("뷰어용 HTML은 mammoth 원본을 유지한다 — rowspan/colspan 보존", () => {
    expect(html).toContain("<table");
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('colspan="2"');
  });
});
