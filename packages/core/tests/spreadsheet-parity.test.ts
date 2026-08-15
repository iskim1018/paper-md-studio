import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convert } from "../src/pipeline.js";
import { buildXls } from "./helpers/biff-writer.js";

/**
 * .xls와 .xlsx의 출력 동일성.
 *
 * 사용자에게 둘은 "같은 엑셀"이다. 같은 내용을 담은 두 파일이 확장자 때문에
 * 다르게 변환되면 그건 버그로 보인다. 두 파서는 격자를 만드는 방법만 다르고
 * 그 이후는 같은 코드(spreadsheet/render.ts)를 타는데, 이 테스트가 그 계약이
 * 깨지는 순간을 잡아낸다.
 *
 * 두 픽스처는 같은 내용을 각자의 형식으로 담는다 (합성 — 비공개 문서 금지).
 */

interface Content {
  readonly sheetName: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string | number | null>>;
  readonly merge?: { r1: number; r2: number; c1: number; c2: number };
  readonly hiddenCols?: ReadonlyArray<number>;
  readonly hiddenRows?: ReadonlyArray<number>;
}

const columnName = (index: number): string => {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
};

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 같은 내용을 XLSX(OOXML)로 */
function buildXlsx(content: Content): Uint8Array {
  const rows = content.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (cell === null || cell === "") return "";
          const ref = `${columnName(c)}${r + 1}`;
          return typeof cell === "number"
            ? `<c r="${ref}"><v>${cell}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      const hidden = content.hiddenRows?.includes(r) ? ' hidden="1"' : "";
      return `<row r="${r + 1}"${hidden}>${cells}</row>`;
    })
    .join("");

  const cols = content.hiddenCols?.length
    ? `<cols>${content.hiddenCols
        .map((c) => `<col min="${c + 1}" max="${c + 1}" hidden="1"/>`)
        .join("")}</cols>`
    : "";

  const merges = content.merge
    ? `<mergeCells count="1"><mergeCell ref="${columnName(content.merge.c1)}${content.merge.r1 + 1}:${columnName(content.merge.c2)}${content.merge.r2 + 1}"/></mergeCells>`
    : "";

  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`;

  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(content.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

/** 같은 내용을 XLS(BIFF8)로 */
function buildXlsFromContent(content: Content): Uint8Array {
  return buildXls([
    {
      name: content.sheetName,
      rows: content.rows,
      ...(content.merge ? { merges: [content.merge] } : {}),
      ...(content.hiddenCols ? { hiddenCols: content.hiddenCols } : {}),
      ...(content.hiddenRows ? { hiddenRows: content.hiddenRows } : {}),
    },
  ]);
}

describe(".xls와 .xlsx 출력 동일성", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "parity-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function convertBoth(
    name: string,
    content: Content,
    includeHidden = false,
  ) {
    const xlsxPath = join(tmpDir, `${name}.xlsx`);
    const xlsPath = join(tmpDir, `${name}.xls`);
    await writeFile(xlsxPath, buildXlsx(content));
    await writeFile(xlsPath, buildXlsFromContent(content));

    const options = includeHidden ? { xlsx: { includeHidden: true } } : {};
    return {
      xlsx: await convert({ inputPath: xlsxPath, ...options }),
      xls: await convert({ inputPath: xlsPath, ...options }),
    };
  }

  it("단순 표의 Markdown이 완전히 같다", async () => {
    const { xlsx, xls } = await convertBoth("단순", {
      sheetName: "재고",
      rows: [
        ["품목", "수량", "비고"],
        ["연필", 100, "재고 많음"],
        ["공책", 20, ""],
      ],
    });

    expect(xls.markdown).toBe(xlsx.markdown);
  });

  it("병합 표의 Markdown이 완전히 같다 — 화살표 표기까지", async () => {
    const { xlsx, xls } = await convertBoth("병합", {
      sheetName: "실적",
      rows: [
        ["분기별 실적", null, null],
        ["1분기", "2분기", "3분기"],
        [10, 20, 30],
      ],
      merge: { r1: 0, r2: 0, c1: 0, c2: 2 },
    });

    expect(xls.markdown).toBe(xlsx.markdown);
  });

  it("숨김 제외 결과와 경고가 같다", async () => {
    const { xlsx, xls } = await convertBoth("숨김", {
      sheetName: "공개",
      rows: [
        ["항목", "숨긴열"],
        ["보임", "메모"],
        ["숨긴행", "x"],
      ],
      hiddenCols: [1],
      hiddenRows: [2],
    });

    expect(xls.markdown).toBe(xlsx.markdown);
    expect(xls.warnings).toEqual(xlsx.warnings);
    expect(xls.hiddenExcluded).toEqual(xlsx.hiddenExcluded);
  });

  it("숨김 포함 결과도 같다", async () => {
    const { xlsx, xls } = await convertBoth(
      "숨김포함",
      {
        sheetName: "공개",
        rows: [
          ["항목", "숨긴열"],
          ["보임", "메모"],
        ],
        hiddenCols: [1],
      },
      true,
    );

    expect(xls.markdown).toBe(xlsx.markdown);
    expect(xls.markdown).toContain("숨긴열");
  });
});
