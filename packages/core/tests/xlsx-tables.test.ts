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

/** 스타일 인덱스: 0 일반 / 1 날짜 / 2 통화(₩) / 3 백분율 */
type CellSpec =
  | string
  | number
  | null
  | { readonly v: number; readonly s: number }
  | { readonly error: string };

interface SheetSpec {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<CellSpec>>;
  readonly merges?: ReadonlyArray<string>;
  /** 숨긴 행 (1-based) */
  readonly hiddenRows?: ReadonlyArray<number>;
  /** 숨긴 열 (1-based) */
  readonly hiddenCols?: ReadonlyArray<number>;
  /** 시트 자체를 숨김 처리 */
  readonly hidden?: boolean;
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

function cellXml(value: CellSpec, ref: string): string {
  if (value === null || value === "") return "";
  if (typeof value === "object") {
    if ("error" in value) {
      return `<c r="${ref}" t="e"><v>${escapeXml(value.error)}</v></c>`;
    }
    // 엑셀은 숫자 셀에 t 속성을 쓰지 않는다 — 실제 저장 형태를 그대로 재현한다
    return `<c r="${ref}" s="${value.s}"><v>${value.v}</v></c>`;
  }
  if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₩&quot;#,##0"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>`;

function sheetXml(sheet: SheetSpec): string {
  const hidden = new Set(sheet.hiddenRows ?? []);
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) =>
          cellXml(cell, `${columnName(colIndex)}${rowIndex + 1}`),
        )
        .join("");
      const hiddenAttr = hidden.has(rowIndex + 1) ? ' hidden="1"' : "";
      return `<row r="${rowIndex + 1}"${hiddenAttr}>${cells}</row>`;
    })
    .join("");
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join("")}</mergeCells>`
    : "";
  // 엑셀은 열 숨김을 셀이 아니라 <cols> 구간에 적는다 (min·max는 1-based)
  const cols = sheet.hiddenCols?.length
    ? `<cols>${sheet.hiddenCols
        .map((c) => `<col min="${c}" max="${c}" hidden="1"/>`)
        .join("")}</cols>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`;
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
  files["xl/styles.xml"] = strToU8(STYLES_XML);
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (s, i) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ""}/>`,
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

  async function convertFile(
    fileName: string,
    sheets: ReadonlyArray<SheetSpec>,
    includeHidden = false,
  ): Promise<{ markdown: string; warnings: ReadonlyArray<string> }> {
    const path = join(tmpDir, `${fileName}.xlsx`);
    await writeFile(path, buildXlsx(sheets));
    const result = await convert({
      inputPath: path,
      ...(includeHidden ? { xlsx: { includeHidden: true } } : {}),
    });
    return { markdown: result.markdown, warnings: result.warnings ?? [] };
  }

  async function convertSheets(
    fileName: string,
    sheets: ReadonlyArray<SheetSpec>,
  ): Promise<string> {
    const { markdown } = await convertFile(fileName, sheets);
    return markdown;
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

  /**
   * 엑셀은 값과 표시형식을 분리 저장하고, 숫자 셀에는 t 속성을 아예 쓰지 않는다.
   * 이 두 사실을 모두 반영하지 않으면 날짜가 45000, 15.7%가 0.157로 나온다.
   */
  describe("표시형식 (날짜·통화·백분율)", () => {
    it("날짜 시리얼을 사람이 읽는 날짜로 되돌린다", async () => {
      const markdown = await convertSheets("날짜", [
        {
          name: "계약",
          rows: [
            ["항목", "체결일"],
            ["A계약", { v: 45000, s: 1 }],
          ],
        },
      ]);

      expect(markdown).toContain("2023-03-15");
      expect(markdown).not.toContain("45000");
    });

    it("통화 서식의 기호와 천단위 구분을 살린다", async () => {
      const markdown = await convertSheets("통화", [
        {
          name: "금액",
          rows: [
            ["항목", "금액"],
            ["계약금", { v: 1234567, s: 2 }],
          ],
        },
      ]);

      expect(markdown).toContain("₩1,234,567");
    });

    it("백분율을 % 표기로 되돌린다", async () => {
      const markdown = await convertSheets("백분율", [
        {
          name: "달성률",
          rows: [
            ["항목", "비율"],
            ["달성", { v: 0.157, s: 3 }],
          ],
        },
      ]);

      expect(markdown).toContain("15.70%");
      expect(markdown).not.toContain("0.157");
    });
  });

  /**
   * 숨긴 시트·행은 대외비인 경우가 많다. 변환 결과는 공유되는 산출물이므로
   * 기본 제외하되, 조용히 빠지면 안 되므로 경고로 알린다.
   */
  describe("숨긴 시트·행", () => {
    it("숨긴 시트를 제외하고 경고로 알린다", async () => {
      const { markdown, warnings } = await convertFile("숨긴시트", [
        {
          name: "공개",
          rows: [
            ["항목", "값"],
            ["매출", 100],
          ],
        },
        { name: "내부검토", hidden: true, rows: [["원가", 42]] },
      ]);

      expect(markdown).toContain("## 공개");
      expect(markdown).not.toContain("내부검토");
      expect(markdown).not.toContain("원가");
      expect(warnings.some((w) => w.includes("숨겨진 시트"))).toBe(true);
      expect(warnings.some((w) => w.includes("내부검토"))).toBe(true);
    });

    it("숨긴 행을 제외한다", async () => {
      const markdown = await convertSheets("숨긴행", [
        {
          name: "목록",
          rows: [
            ["항목", "값"],
            ["보이는행", 1],
            ["숨긴행", 999],
          ],
          hiddenRows: [3],
        },
      ]);

      expect(markdown).toContain("보이는행");
      expect(markdown).not.toContain("숨긴행");
      expect(markdown).not.toContain("999");
    });

    it("숨긴 열을 제외한다 — 열이 많아 접어둔 경우가 흔하다", async () => {
      const { markdown, warnings } = await convertFile("숨긴열", [
        {
          name: "넓은표",
          rows: [
            ["항목", "숨긴열", "값"],
            ["A", "내부메모", 100],
          ],
          hiddenCols: [2],
        },
      ]);

      expect(markdown).toContain("| 항목 | 값 |");
      expect(markdown).not.toContain("숨긴열");
      expect(markdown).not.toContain("내부메모");
      expect(warnings.some((w) => w.includes("열 1개"))).toBe(true);
    });

    it("경고가 포함 방법(--include-hidden)을 함께 알려준다", async () => {
      const { warnings } = await convertFile("안내", [
        {
          name: "표",
          rows: [
            ["항목", "값"],
            ["A", 1],
          ],
          hiddenRows: [2],
        },
      ]);

      expect(warnings.some((w) => w.includes("--include-hidden"))).toBe(true);
    });
  });

  /**
   * 숨김의 의도(대외비 은닉 / 보기 편하려고 접어둠)는 문서만 보고 알 수 없다.
   * 기본은 안전한 쪽(제외)이되, 사용자가 뒤집을 수 있어야 한다.
   */
  describe("includeHidden 옵션", () => {
    const sheets: ReadonlyArray<SheetSpec> = [
      {
        name: "공개",
        rows: [
          ["항목", "접은열", "값"],
          ["A", "메모", 100],
          ["접은행", "메모2", 200],
        ],
        hiddenRows: [3],
        hiddenCols: [2],
      },
      { name: "접은시트", hidden: true, rows: [["시트내용", 42]] },
    ];

    it("켜면 숨긴 시트·행·열을 모두 포함한다", async () => {
      const { markdown, warnings } = await convertFile("포함", sheets, true);

      expect(markdown).toContain("접은열");
      expect(markdown).toContain("접은행");
      expect(markdown).toContain("## 접은시트");
      expect(markdown).toContain("시트내용");
      expect(warnings).toHaveLength(0);
    });

    it("끄면(기본) 모두 제외하고 경고를 남긴다", async () => {
      const { markdown, warnings } = await convertFile("제외", sheets);

      expect(markdown).not.toContain("접은열");
      expect(markdown).not.toContain("접은행");
      expect(markdown).not.toContain("접은시트");
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("숨긴 열과 겹친 병합의 열 수를 다시 계산해 표를 유지한다", async () => {
      // A1:C1 제목 병합인데 B열이 숨김 → 보이는 열은 2개
      const { markdown } = await convertFile("병합과숨김", [
        {
          name: "표",
          rows: [
            ["연간 보고", null, null],
            ["구분", "숨김", "값"],
            ["A", "x", 1],
          ],
          merges: ["A1:C1"],
          hiddenCols: [2],
        },
      ]);

      const tableLines = markdown
        .split("\n")
        .filter((line) => line.startsWith("|"));
      for (const line of tableLines) {
        expect(line.split(/(?<!\\)\|/)).toHaveLength(4); // 2열 → 4조각
      }
      expect(markdown).toContain(`| 연간 보고 | ${MERGE_LEFT} |`);
    });
  });

  describe("특수 문자와 오류값", () => {
    it("셀 안 줄바꿈을 <br>로 유지해 표를 깨뜨리지 않는다", async () => {
      const markdown = await convertSheets("줄바꿈", [
        {
          name: "설명",
          rows: [
            ["항목", "내용"],
            ["A", "첫 줄\n둘째 줄"],
          ],
        },
      ]);

      expect(markdown).toContain("첫 줄<br>둘째 줄");
      const tableLines = markdown
        .split("\n")
        .filter((line) => line.startsWith("|"));
      expect(tableLines).toHaveLength(3); // 헤더 + separator + 1행
    });

    it("셀 안의 파이프를 escape 해 열이 어긋나지 않게 한다", async () => {
      const markdown = await convertSheets("파이프", [
        {
          name: "특수",
          rows: [
            ["항목", "값"],
            ["구분", "가|나"],
          ],
        },
      ]);

      const row = markdown.split("\n").find((line) => line.includes("가"));
      expect(row).toContain("가\\|나");
      expect(row?.split(/(?<!\\)\|/)).toHaveLength(4);
    });

    it("수식 오류값을 그대로 보존한다", async () => {
      const markdown = await convertSheets("오류", [
        {
          name: "오류",
          rows: [
            ["항목", "값"],
            ["나누기", { error: "#DIV/0!" }],
            ["참조", { error: "#REF!" }],
          ],
        },
      ]);

      expect(markdown).toContain("#DIV/0!");
      expect(markdown).toContain("#REF!");
    });
  });

  describe("대형 시트", () => {
    it("행 상한을 넘으면 잘라내되 경고로 알린다 — 조용한 손실 금지", async () => {
      const rows: Array<Array<CellSpec>> = [["번호", "값"]];
      for (let i = 1; i <= 5200; i += 1) rows.push([i, `값${i}`]);

      const { markdown, warnings } = await convertFile("대형", [
        { name: "대형", rows },
      ]);

      expect(warnings.some((w) => w.includes("너무 커서"))).toBe(true);
      expect(markdown).toContain("값1 |");
      expect(markdown).not.toContain("값5200");
    });

    it("상한 이내면 모든 행을 변환한다", async () => {
      const rows: Array<Array<CellSpec>> = [["번호"]];
      for (let i = 1; i <= 300; i += 1) rows.push([i]);

      const { markdown, warnings } = await convertFile("보통크기", [
        { name: "보통", rows },
      ]);

      expect(warnings).toHaveLength(0);
      expect(markdown).toContain("| 300 |");
    });
  });
});
