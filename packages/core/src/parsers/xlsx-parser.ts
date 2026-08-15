import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { htmlToMarkdownKeepingTables } from "../html-to-md.js";
import {
  createImageAsset,
  makeImageName,
  mimeFromExt,
} from "../image-utils.js";
import type {
  HiddenExclusion,
  ImageAsset,
  ParseOptions,
  ParseResult,
  Parser,
} from "../types.js";
import { normalizeHtmlTablesToGfm } from "./html-tables-to-gfm.js";
import type { NumberFormats } from "./xlsx/cell-format.js";
import { buildNumberFormats } from "./xlsx/cell-format.js";
import type { VisibleGrid } from "./xlsx/visibility.js";
import { projectVisibleGrid } from "./xlsx/visibility.js";
import type { SheetRef } from "./xlsx/workbook.js";
import {
  parseRelationships,
  parseSharedStrings,
  parseWorkbook,
  resolveZipPath,
} from "./xlsx/workbook.js";
import type { CellSpan, SheetGrid } from "./xlsx/worksheet.js";
import { parseWorksheet } from "./xlsx/worksheet.js";

/**
 * XLSX → HTML → Markdown 파서.
 *
 * kordoc 대신 직접 파싱한다. 표시형식(styles.xml)·그림(drawings)·하이퍼링크·
 * 숨김 상태는 kordoc이 읽지 않는 파트라 위임해서는 복원할 방법이 없다 —
 * 특히 날짜가 시리얼 숫자(45000)로 남는 문제는 사후 보정이 불가능하다.
 *
 * 표는 colspan/rowspan을 살린 HTML로 만든 뒤 `normalizeHtmlTablesToGfm`에
 * 넘긴다. HWPX·DOCX와 같은 함수를 타므로 병합 화살표·grid 정규화 계약이
 * 자동으로 일치한다.
 */

/** 시트 하나에서 읽을 최대 행·열. 초과분은 잘라내고 반드시 경고를 남긴다. */
const MAX_ROWS_PER_SHEET = 5000;
const MAX_COLS_PER_SHEET = 200;

const drawingParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (tagName) =>
    ["twoCellAnchor", "oneCellAnchor", "absoluteAnchor", "pic"].includes(
      tagName,
    ),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DrawingImage {
  readonly embedId: string;
  readonly alt: string;
}

function toArray<T>(value: T | Array<T> | undefined): Array<T> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 드로잉 XML에서 그림 목록(관계 ID + 대체텍스트)을 뽑는다 */
function parseDrawingImages(xml: string): Array<DrawingImage> {
  const doc = drawingParser.parse(xml) as Record<string, unknown>;
  const root = (doc.wsDr ?? {}) as Record<string, unknown>;
  const anchors = [
    ...toArray(root.twoCellAnchor as Array<Record<string, unknown>>),
    ...toArray(root.oneCellAnchor as Array<Record<string, unknown>>),
    ...toArray(root.absoluteAnchor as Array<Record<string, unknown>>),
  ];

  const images: Array<DrawingImage> = [];
  for (const anchor of anchors) {
    for (const pic of toArray(anchor.pic as Array<Record<string, unknown>>)) {
      const nvPicPr = (pic.nvPicPr ?? {}) as Record<string, unknown>;
      const cNvPr = (nvPicPr.cNvPr ?? {}) as Record<string, unknown>;
      const blipFill = (pic.blipFill ?? {}) as Record<string, unknown>;
      const blip = (blipFill.blip ?? {}) as Record<string, unknown>;
      const embedId = String(blip["@_embed"] ?? "");
      if (!embedId) continue;
      const alt =
        String(cNvPr["@_descr"] ?? "") || String(cNvPr["@_name"] ?? "그림");
      images.push({ embedId, alt });
    }
  }
  return images;
}

/** 병합 크기를 colspan/rowspan 속성 문자열로 (1칸이면 빈 문자열) */
function spanAttributes(span: CellSpan | undefined): string {
  if (!span) return "";
  const attrs: Array<string> = [];
  if (span.colSpan > 1) attrs.push(`colspan="${span.colSpan}"`);
  if (span.rowSpan > 1) attrs.push(`rowspan="${span.rowSpan}"`);
  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

/**
 * 원본에서 숨김이던 자리에 붙는 클래스. 뷰어가 흐리게 표시해 "감춰져 있던
 * 칸"임을 알린다. Markdown 변환에는 영향이 없다 (turndown이 클래스를 버린다).
 */
const HIDDEN_ROW_CLASS = "xlsx-hidden-row";
const HIDDEN_COL_CLASS = "xlsx-hidden-col";

/** 셀 하나를 <td>/<th>로 만든다 */
function renderCell(
  text: string,
  span: CellSpan | undefined,
  href: string | undefined,
  isHeader: boolean,
  isHiddenCol: boolean,
): string {
  // 셀 안 줄바꿈(Alt+Enter)은 \n으로 저장된다. HTML에서 \n은 공백으로 접히므로
  // <br>로 바꿔야 원본의 줄 구분이 살아남는다.
  const escaped = escapeHtml(text).replace(/\r?\n/g, "<br>");
  const content = href
    ? `<a href="${escapeHtml(href)}">${escaped || escapeHtml(href)}</a>`
    : escaped;
  const tag = isHeader ? "th" : "td";
  const cls = isHiddenCol ? ` class="${HIDDEN_COL_CLASS}"` : "";
  return `<${tag}${spanAttributes(span)}${cls}>${content}</${tag}>`;
}

/** 격자(숨김 반영 완료)를 HTML 표로 만든다 */
function gridToHtmlTable(
  grid: VisibleGrid,
  hyperlinkTargets: ReadonlyMap<string, string>,
  limits: { rows: number; cols: number },
): string {
  const rows: Array<string> = [];

  for (let r = 0; r < limits.rows; r += 1) {
    const cells: Array<string> = [];

    for (let c = 0; c < limits.cols; c += 1) {
      const position = `${r},${c}`;
      if (grid.covered.has(position)) continue;
      cells.push(
        renderCell(
          grid.cells[r]?.[c] ?? "",
          grid.spans.get(position),
          hyperlinkTargets.get(position),
          r === 0,
          grid.hiddenCols.has(c),
        ),
      );
    }

    if (cells.length === 0) continue;
    const rowClass = grid.hiddenRows.has(r)
      ? ` class="${HIDDEN_ROW_CLASS}"`
      : "";
    rows.push(`<tr${rowClass}>${cells.join("")}</tr>`);
  }

  return rows.length > 0 ? `<table>${rows.join("")}</table>` : "";
}

type ZipFiles = Record<string, Uint8Array>;

function readText(files: ZipFiles, path: string): string | null {
  const entry = files[path];
  return entry ? strFromU8(entry) : null;
}

interface SheetContext {
  readonly files: ZipFiles;
  readonly workbookRels: ReadonlyMap<string, string>;
  readonly sharedStrings: ReadonlyArray<string>;
  readonly formats: NumberFormats;
  readonly date1904: boolean;
  readonly images: Array<ImageAsset>;
  readonly warnings: Array<string>;
  readonly imagesDirName: string;
  readonly includeHidden: boolean;
  /** 제외한 숨김 항목 누계 — UI가 "포함해 다시 변환"을 띄울 근거 */
  readonly excluded: HiddenExclusion;
}

/**
 * 숨김 제외로 실제로 빠진 것이 있으면 무엇이 빠졌는지 알린다.
 *
 * "어떻게 포함하는지"는 여기서 말하지 않는다 — core는 자기가 CLI에서 쓰이는지
 * GUI에서 쓰이는지 모른다. 되돌리는 방법 안내는 각 진입점의 몫이다.
 */
function hiddenExclusionWarning(
  sheetName: string,
  hiddenRows: number,
  hiddenCols: number,
): string | null {
  if (hiddenRows === 0 && hiddenCols === 0) return null;
  const parts: Array<string> = [];
  if (hiddenRows > 0) parts.push(`행 ${hiddenRows}개`);
  if (hiddenCols > 0) parts.push(`열 ${hiddenCols}개`);
  return `시트 "${sheetName}"의 숨겨진 ${parts.join("·")}를 제외했습니다.`;
}

export class XlsxParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const files = this.unzip(buffer);

    const workbookXml = readText(files, "xl/workbook.xml");
    if (!workbookXml) {
      throw new Error(
        "올바른 XLSX 파일이 아닙니다 (xl/workbook.xml을 찾을 수 없습니다).",
      );
    }

    const { sheets, date1904 } = parseWorkbook(workbookXml);
    if (sheets.length === 0) {
      throw new Error("통합 문서에 시트가 없습니다.");
    }

    const warnings: Array<string> = [];
    const images: Array<ImageAsset> = [];
    const excluded: HiddenExclusion = { sheets: 0, rows: 0, cols: 0 };
    const context: SheetContext = {
      files,
      workbookRels: parseRelationships(
        readText(files, "xl/_rels/workbook.xml.rels") ?? "<Relationships/>",
      ),
      sharedStrings: parseSharedStrings(
        readText(files, "xl/sharedStrings.xml") ?? "<sst/>",
      ),
      formats: buildNumberFormats(
        readText(files, "xl/styles.xml") ?? "<styleSheet/>",
      ),
      date1904,
      images,
      warnings,
      imagesDirName: options.imagesDirName,
      includeHidden: options.xlsx?.includeHidden === true,
      excluded,
    };

    const hiddenSheets = sheets.filter((sheet) => sheet.hidden);
    if (hiddenSheets.length > 0 && !context.includeHidden) {
      excluded.sheets = hiddenSheets.length;
      warnings.push(
        `숨겨진 시트 ${hiddenSheets.length}개를 제외했습니다: ${hiddenSheets
          .map((sheet) => sheet.name)
          .join(", ")}`,
      );
    }

    const htmlParts: Array<string> = [];
    for (const sheet of sheets) {
      if (sheet.hidden && !context.includeHidden) continue;
      const sheetHtml = this.renderSheet(sheet, context);
      if (sheetHtml) htmlParts.push(sheetHtml);
    }

    const html = htmlParts.join("\n");
    const markdown = normalizeHtmlTablesToGfm(
      htmlToMarkdownKeepingTables(html),
    );

    return {
      html,
      markdown,
      images,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(excluded.sheets + excluded.rows + excluded.cols > 0
        ? { hiddenExcluded: excluded }
        : {}),
    };
  }

  private unzip(buffer: Buffer): ZipFiles {
    try {
      return unzipSync(new Uint8Array(buffer));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`XLSX 파일을 열 수 없습니다 (손상 가능성): ${detail}`);
    }
  }

  private renderSheet(sheet: SheetRef, ctx: SheetContext): string {
    const target = ctx.workbookRels.get(sheet.relId);
    const sheetPath = target
      ? resolveZipPath("xl", target)
      : "xl/worksheets/sheet1.xml";
    const sheetXml = readText(ctx.files, sheetPath);
    if (!sheetXml) {
      ctx.warnings.push(
        `시트 "${sheet.name}"의 내용을 찾을 수 없어 건너뛰었습니다.`,
      );
      return "";
    }

    const raw = parseWorksheet(
      sheetXml,
      ctx.sharedStrings,
      ctx.formats,
      ctx.date1904,
    );

    if (!ctx.includeHidden) {
      ctx.excluded.rows += raw.hiddenRows.size;
      ctx.excluded.cols += raw.hiddenCols.size;
      const warning = hiddenExclusionWarning(
        sheet.name,
        raw.hiddenRows.size,
        raw.hiddenCols.size,
      );
      if (warning) ctx.warnings.push(warning);
    }
    const grid = projectVisibleGrid(raw, ctx.includeHidden);

    const totalRows = grid.cells.length;
    const totalCols = grid.cells[0]?.length ?? 0;
    const rows = Math.min(totalRows, MAX_ROWS_PER_SHEET);
    const cols = Math.min(totalCols, MAX_COLS_PER_SHEET);
    if (rows < totalRows || cols < totalCols) {
      ctx.warnings.push(
        `시트 "${sheet.name}"가 너무 커서 ${rows}행 × ${cols}열까지만 변환했습니다 ` +
          `(원본 ${totalRows}행 × ${totalCols}열).`,
      );
    }

    const parts = [`<h2>${escapeHtml(sheet.name)}</h2>`];
    const table = gridToHtmlTable(
      grid,
      this.resolveHyperlinks(grid, ctx.files, sheetPath),
      { rows, cols },
    );
    if (table) parts.push(table);
    parts.push(...this.collectImages(raw, ctx, sheetPath));

    return parts.join("\n");
  }

  private resolveHyperlinks(
    grid: VisibleGrid,
    files: ZipFiles,
    sheetPath: string,
  ): Map<string, string> {
    const resolved = new Map<string, string>();
    if (grid.hyperlinkRels.size === 0) return resolved;

    const relsXml = readText(files, relsPathFor(sheetPath));
    if (!relsXml) return resolved;

    const rels = parseRelationships(relsXml);
    for (const [position, relId] of grid.hyperlinkRels) {
      const target = rels.get(relId);
      if (target) resolved.set(position, target);
    }
    return resolved;
  }

  private collectImages(
    grid: SheetGrid,
    ctx: SheetContext,
    sheetPath: string,
  ): Array<string> {
    if (!grid.drawingRelId) return [];

    const sheetRelsXml = readText(ctx.files, relsPathFor(sheetPath));
    if (!sheetRelsXml) return [];

    const drawingTarget = parseRelationships(sheetRelsXml).get(
      grid.drawingRelId,
    );
    if (!drawingTarget) return [];

    const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
    const drawingPath = resolveZipPath(sheetDir, drawingTarget);
    const drawingXml = readText(ctx.files, drawingPath);
    if (!drawingXml) return [];

    const drawingDir = drawingPath.slice(0, drawingPath.lastIndexOf("/"));
    const drawingRels = parseRelationships(
      readText(ctx.files, relsPathFor(drawingPath)) ?? "<Relationships/>",
    );

    const tags: Array<string> = [];
    for (const image of parseDrawingImages(drawingXml)) {
      const target = drawingRels.get(image.embedId);
      if (!target) continue;
      const mediaPath = resolveZipPath(drawingDir, target);
      const data = ctx.files[mediaPath];
      if (!data) continue;

      const ext = mediaPath.slice(mediaPath.lastIndexOf("."));
      const name = makeImageName(ctx.images.length + 1, ext);
      ctx.images.push(createImageAsset(name, data, mimeFromExt(mediaPath)));
      tags.push(
        `<p><img src="./${ctx.imagesDirName}/${name}" alt="${escapeHtml(image.alt)}"></p>`,
      );
    }
    return tags;
  }
}

/** `xl/worksheets/sheet1.xml` → `xl/worksheets/_rels/sheet1.xml.rels` */
function relsPathFor(partPath: string): string {
  return partPath.replace(/([^/]+)$/, (name) => `_rels/${name}.rels`);
}
