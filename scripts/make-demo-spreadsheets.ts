/**
 * 데모용 엑셀 파일 생성기.
 *
 * 저장소에는 실물 엑셀이 없다 (비공개 문서 규칙). GUI 데모에서 최근 추가된
 * 기능 — 표시형식·병합·숨김 행/열/시트·이미지·하이퍼링크, 그리고 .xls/.xlsx
 * 출력 동일성 — 을 눈으로 확인하려면 합성 표본이 필요하다.
 *
 * 실행: node scripts/make-demo-spreadsheets.mjs (esbuild 번들 경유, 아래 참고)
 *   npx esbuild scripts/make-demo-spreadsheets.ts --bundle --platform=node \
 *     --format=esm --external:cfb --external:fflate --outfile=<tmp>.mjs && node <tmp>.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { buildXls } from "../packages/core/tests/helpers/biff-writer.js";

/** 번들 후 실행 위치가 달라질 수 있어 저장소 루트는 cwd 로 잡는다 */
const repoRoot = process.cwd();
const outDir = join(repoRoot, "samples", "demo");

/** 2026-08-17 의 엑셀 날짜 시리얼 (1900 날짜 체계) */
const D_20260817 = 46251;
const D_20260901 = 46266;
const D_20261001 = 46296;

type Cell =
  | string
  | number
  | null
  | { readonly v: number; readonly s: number }
  | { readonly text: string; readonly href: string };

interface SheetSpec {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<Cell>>;
  readonly merges?: ReadonlyArray<string>;
  /** 숨긴 행 (1-based) */
  readonly hiddenRows?: ReadonlyArray<number>;
  /** 숨긴 열 (1-based) */
  readonly hiddenCols?: ReadonlyArray<number>;
  readonly hidden?: boolean;
  /** 시트에 얹을 그림 파일 (png) */
  readonly image?: string;
}

const escapeXml = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function columnName(index: number): string {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** 스타일 인덱스: 0 일반 / 1 날짜 / 2 통화(₩) / 3 백분율 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₩&quot;#,##0"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>`;

interface SheetXml {
  readonly xml: string;
  readonly rels: string | null;
  readonly hasDrawing: boolean;
}

function sheetXml(sheet: SheetSpec, sheetIndex: number): SheetXml {
  const hiddenRows = new Set(sheet.hiddenRows ?? []);
  const links: Array<{ ref: string; href: string }> = [];

  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (cell === null || cell === "") return "";
          const ref = `${columnName(c)}${r + 1}`;
          if (typeof cell === "object" && "href" in cell) {
            links.push({ ref, href: cell.href });
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.text)}</t></is></c>`;
          }
          if (typeof cell === "object") {
            // 엑셀은 숫자 셀에 t 속성을 쓰지 않는다 — 실제 저장 형태 그대로
            return `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
          }
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      const hidden = hiddenRows.has(r + 1) ? ' hidden="1"' : "";
      return `<row r="${r + 1}"${hidden}>${cells}</row>`;
    })
    .join("");

  const cols = sheet.hiddenCols?.length
    ? `<cols>${sheet.hiddenCols.map((c) => `<col min="${c}" max="${c}" hidden="1"/>`).join("")}</cols>`
    : "";
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";

  // 하이퍼링크와 그림은 시트 관계 파일(rels)을 거친다
  const relParts: Array<string> = [];
  const linkXml = links
    .map((link, i) => {
      const id = `rIdLink${i + 1}`;
      relParts.push(
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.href)}" TargetMode="External"/>`,
      );
      return `<hyperlink ref="${link.ref}" r:id="${id}"/>`;
    })
    .join("");
  const hyperlinks = linkXml
    ? `<hyperlinks>${linkXml}</hyperlinks>`
    : "";

  let drawing = "";
  if (sheet.image) {
    relParts.push(
      `<Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${sheetIndex + 1}.xml"/>`,
    );
    drawing = `<drawing r:id="rIdDrawing"/>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${cols}<sheetData>${rows}</sheetData>${merges}${hyperlinks}${drawing}</worksheet>`;
  const rels = relParts.length
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relParts.join("")}</Relationships>`
    : null;

  return { xml, rels, hasDrawing: Boolean(sheet.image) };
}

const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="로고"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

function buildXlsx(
  sheets: ReadonlyArray<SheetSpec>,
  imageBytes?: Uint8Array,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const rendered = sheets.map((s, i) => sheetXml(s, i));

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const drawingOverrides = rendered
    .map((r, i) =>
      r.hasDrawing
        ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
        : "",
    )
    .join("");

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}${drawingOverrides}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/styles.xml"] = strToU8(STYLES_XML);
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
      .join("")}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );

  rendered.forEach((r, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(r.xml);
    if (r.rels) {
      files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(r.rels);
    }
    if (r.hasDrawing && imageBytes) {
      files[`xl/drawings/drawing${i + 1}.xml`] = strToU8(drawingXml);
      files[`xl/drawings/_rels/drawing${i + 1}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
      );
      files["xl/media/image1.png"] = imageBytes;
    }
  });

  return zipSync(files);
}

// ─────────────────────────────────────────────────────────────
// 1) 풀 기능 데모 — 병합·날짜·통화·백분율·숨김(행/열/시트)·이미지·하이퍼링크
// ─────────────────────────────────────────────────────────────
const logo = new Uint8Array(
  readFileSync(
    join(outDir, "제주_2박3일_여행계획서_데모_images", "img_001.png"),
  ),
);

const 견적서: ReadonlyArray<SheetSpec> = [
  {
    name: "견적서",
    image: "logo",
    merges: ["A1:E1", "A2:A4"],
    // 4행 = 내부 마진(숨김), D열 = 원가(숨김)
    hiddenRows: [9],
    hiddenCols: [4],
    rows: [
      ["2026년 상반기 문서변환 솔루션 견적서", null, null, null, null],
      ["기본 정보", "작성일", { v: D_20260817, s: 1 }, "담당자", "김인성"],
      [null, "유효기한", { v: D_20260901, s: 1 }, "부서", "플랫폼개발팀"],
      [null, "납품 예정", { v: D_20261001, s: 1 }, "연락처", "02-000-0000"],
      ["품목", "수량", "단가", "원가", "금액"],
      ["변환 엔진 라이선스", 3, { v: 4500000, s: 2 }, { v: 2100000, s: 2 }, { v: 13500000, s: 2 }],
      ["데스크톱 앱 (macOS/Windows)", 1, { v: 8000000, s: 2 }, { v: 3600000, s: 2 }, { v: 8000000, s: 2 }],
      ["유지보수 (12개월)", 1, { v: 2400000, s: 2 }, { v: 900000, s: 2 }, { v: 2400000, s: 2 }],
      ["내부 마진율(대외비)", null, null, null, { v: 0.421, s: 3 }],
      ["할인율", null, null, null, { v: 0.075, s: 3 }],
      ["합계", null, null, null, { v: 22127500, s: 2 }],
      [
        "제품 문서",
        { text: "github.com/iskim/paper-md-studio", href: "https://github.com/iskim/paper-md-studio" },
        null,
        null,
        null,
      ],
    ],
  },
  {
    name: "지원 포맷",
    rows: [
      ["포맷", "파서", "표 계약", "비고"],
      ["HWPX", "자체", "GFM", "PUA 정규화·중첩표"],
      ["HWP 5.0", "kordoc", "GFM", "Java 폴백 있음"],
      ["DOCX", "mammoth+자체", "GFM", "병합 화살표"],
      ["PDF", "pdf-inspector", "GFM", "표 감지 개선"],
      ["XLSX / XLS", "자체", "GFM", "표시형식·숨김·이미지"],
    ],
  },
  {
    name: "내부검토",
    hidden: true,
    rows: [
      ["검토 항목", "결과"],
      ["원가율", "46.7%"],
      ["경쟁사 대비", "12% 저가"],
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// 2) 동일성 데모 — 같은 내용을 .xlsx / .xls 두 형식으로
// ─────────────────────────────────────────────────────────────
const 실적_rows = [
  ["2026년 분기 실적", null, null, null],
  ["구분", "매출", "원가", "기준일"],
  ["1분기", { v: 128_000_000, s: 2 }, { v: 61_000_000, s: 2 }, { v: 46023, s: 1 }],
  ["2분기", { v: 146_500_000, s: 2 }, { v: 68_200_000, s: 2 }, { v: 46113, s: 1 }],
  ["비공개 행", { v: 1, s: 2 }, { v: 1, s: 2 }, { v: 46113, s: 1 }],
  ["상반기 계", { v: 274_500_000, s: 2 }, { v: 129_200_000, s: 2 }, null],
] as const;

const 실적_xlsx: ReadonlyArray<SheetSpec> = [
  {
    name: "실적",
    merges: ["A1:D1"],
    hiddenRows: [5],
    hiddenCols: [3],
    rows: 실적_rows as unknown as ReadonlyArray<ReadonlyArray<Cell>>,
  },
];

// .xls 는 XF 인덱스 16부터 — 16=날짜(14), 17=통화(164)
const toXlsCell = (cell: Cell) => {
  if (cell !== null && typeof cell === "object" && "v" in cell) {
    return { v: cell.v, xf: cell.s === 1 ? 16 : 17 };
  }
  return cell as string | number | null;
};

const 실적_xls = buildXls(
  [
    {
      name: "실적",
      rows: 실적_rows.map((row) => row.map(toXlsCell)),
      merges: [{ r1: 0, r2: 0, c1: 0, c2: 3 }],
      hiddenRows: [4],
      hiddenCols: [2],
    },
  ],
  {
    formats: [{ id: 164, code: '"₩"#,##0' }],
    xfs: [14, 164],
  },
);

mkdirSync(outDir, { recursive: true });
const written: Array<string> = [];
const write = (name: string, bytes: Uint8Array) => {
  const path = join(outDir, name);
  writeFileSync(path, bytes);
  written.push(path);
};

write("견적서_2026상반기_데모.xlsx", buildXlsx(견적서, logo));
write("분기실적_데모.xlsx", buildXlsx(실적_xlsx));
write("분기실적_데모.xls", 실적_xls);

for (const path of written) console.log(`생성: ${path}`);
