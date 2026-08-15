import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MERGE_LEFT, MERGE_UP } from "../src/parsers/html-tables-to-gfm.js";
import { convert } from "../src/pipeline.js";

/**
 * XLSX 표 → GFM 계약 테스트.
 *
 * kordoc은 병합(mergeCells)이 있는 시트를 colspan/rowspan HTML `<table>`로
 * 내보낸다. 충실하지만 HWPX·DOCX 경로와 계약이 달라, 같은 병합 표가 포맷마다
 * 다르게 보이고 태그 오버헤드로 토큰도 더 든다 (합성 표본 실측: 병합 193→98자,
 * 보고서형 405→232자). `normalizeTables`로 같은 GFM 계약에 태운다.
 *
 * 픽스처는 합성 OOXML이다 (비공개 문서 발췌 금지).
 */

interface SheetSpec {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string | number | null>>;
  readonly merges?: ReadonlyArray<string>;
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function columnName(index: number): string {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function cellXml(value: string | number | null, ref: string): string {
  if (value === null || value === "") return "";
  if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: SheetSpec): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) =>
          cellXml(cell, `${columnName(colIndex)}${rowIndex + 1}`),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${merges}</worksheet>`;
}

function buildXlsx(sheets: ReadonlyArray<SheetSpec>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (s, i) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });

  return zipSync(files);
}

describe("XLSX 표 변환", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "xlsx-tables-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function convertSheets(
    fileName: string,
    sheets: ReadonlyArray<SheetSpec>,
  ): Promise<string> {
    const path = join(tmpDir, `${fileName}.xlsx`);
    await writeFile(path, buildXlsx(sheets));
    const result = await convert({ inputPath: path });
    return result.markdown;
  }

  it("가로 병합을 GFM 표 + 왼쪽 화살표로 내린다", async () => {
    const markdown = await convertSheets("가로병합", [
      {
        name: "실적",
        rows: [
          ["분기별 실적", null, null],
          ["1분기", "2분기", "3분기"],
        ],
        merges: ["A1:C1"],
      },
    ]);

    expect(markdown).toContain(
      `| 분기별 실적 | ${MERGE_LEFT} | ${MERGE_LEFT} |`,
    );
    expect(markdown).toContain("| 1분기 | 2분기 | 3분기 |");
    expect(markdown).not.toContain("<table");
  });

  it("세로 병합 연속 자리에 위쪽 화살표를 남긴다", async () => {
    const markdown = await convertSheets("세로병합", [
      {
        name: "구분",
        rows: [
          ["구분", "값"],
          [null, "둘째"],
        ],
        merges: ["A1:A2"],
      },
    ]);

    expect(markdown).toContain(`| ${MERGE_UP} | 둘째 |`);
    expect(markdown).not.toContain("<table");
  });

  it("모든 행의 열 수가 같아 GFM 표가 깨지지 않는다", async () => {
    const markdown = await convertSheets("행폭", [
      {
        name: "보고서",
        rows: [
          ["2026년 결과 보고", null, null, null],
          ["구분", "계획", "실적", "달성률"],
          ["API 공개", 10, 12, "120%"],
        ],
        merges: ["A1:D1"],
      },
    ]);

    const tableLines = markdown
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(tableLines.length).toBeGreaterThan(0);
    for (const line of tableLines) {
      expect(line.split(/(?<!\\)\|/)).toHaveLength(6); // 4열 → 6조각
    }
  });

  it("시트마다 시트명 제목을 붙인다", async () => {
    const markdown = await convertSheets("다중시트", [
      {
        name: "1월",
        rows: [
          ["항목", "값"],
          ["매출", 100],
        ],
      },
      {
        name: "2월",
        rows: [
          ["항목", "값"],
          ["매출", 200],
        ],
      },
    ]);

    expect(markdown).toContain("## 1월");
    expect(markdown).toContain("## 2월");
  });

  it("병합이 없는 시트는 종전대로 GFM 표를 유지한다", async () => {
    const markdown = await convertSheets("단순표", [
      {
        name: "재고",
        rows: [
          ["품목", "수량"],
          ["연필", 100],
        ],
      },
    ]);

    expect(markdown).toContain("| 품목 | 수량 |");
    expect(markdown).toContain("| 연필 | 100 |");
    expect(markdown).not.toContain("<table");
  });
});
