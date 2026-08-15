import { XMLParser } from "fast-xml-parser";
import type { NumberFormats } from "../spreadsheet/cell-format.js";
import { formatCellValue } from "../spreadsheet/cell-format.js";
import type { CellSpan, SheetGrid } from "../spreadsheet/grid.js";
import {
  buildMergeMaps,
  cellKey,
  extendBounds,
  parseCellRef,
  toDenseGrid,
} from "../spreadsheet/grid.js";

/**
 * 워크시트(xl/worksheets/sheetN.xml) → 셀 격자.
 *
 * 엑셀 셀의 값 종류(t 속성)는 생략 가능하다 — 숫자 셀은 t를 아예 쓰지 않는다.
 * 그래서 "t가 없으면 숫자"가 기본 규칙이고, 이 판정을 틀리면 날짜·통화 서식이
 * 통째로 적용되지 않는다.
 */

const worksheetParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (tagName) =>
    ["row", "c", "mergeCell", "hyperlink", "is", "r", "t"].includes(tagName),
});

function toArray<T>(value: T | Array<T> | undefined): Array<T> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 텍스트 노드 값을 문자열로 (fast-xml-parser는 숫자를 number로 바꾼다) */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("#text" in record) return String(record["#text"] ?? "");
    return "";
  }
  return String(node);
}

/** inlineStr(`<is>`)의 서식 런을 이어붙인다 */
function inlineString(isNode: unknown): string {
  const node = (Array.isArray(isNode) ? isNode[0] : isNode) as
    | Record<string, unknown>
    | undefined;
  if (!node) return "";
  const runs = toArray(node.r as Array<Record<string, unknown>> | undefined);
  if (runs.length > 0) {
    return runs.map((run) => toArray(run.t).map(textOf).join("")).join("");
  }
  return toArray(node.t).map(textOf).join("");
}

interface CellContext {
  readonly sharedStrings: ReadonlyArray<string>;
  readonly formats: NumberFormats;
  readonly date1904: boolean;
}

/**
 * 셀 하나의 표시 텍스트를 만든다.
 *
 * `t` 속성이 없으면 숫자다 (엑셀이 기본값을 생략한다). 이 경우에만 표시형식을
 * 적용해야 날짜·통화가 사람이 읽는 형태로 나온다.
 */
function cellText(cell: Record<string, unknown>, ctx: CellContext): string {
  const type = cell["@_t"] === undefined ? "n" : String(cell["@_t"]);
  const rawValue = textOf(cell.v);

  if (type === "s") {
    const index = Number(rawValue);
    return ctx.sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") return inlineString(cell.is);
  if (type === "b") return rawValue === "1" ? "TRUE" : "FALSE";
  if (type === "e" || type === "str") return rawValue;

  if (rawValue === "") {
    // 캐시된 계산값이 없는 수식은 수식 자체를 남긴다 (빈칸보다 정보가 많다)
    const formula = textOf(cell.f);
    return formula === "" ? "" : `=${formula}`;
  }

  const styleIndex = Number(cell["@_s"] ?? Number.NaN);
  const formatId = Number.isInteger(styleIndex)
    ? (ctx.formats.xfFormatIds[styleIndex] ?? 0)
    : 0;
  return formatCellValue(
    rawValue,
    formatId,
    ctx.formats.customFormats,
    ctx.date1904,
  );
}

/**
 * 숨긴 열을 모은다.
 *
 * 엑셀은 열 속성을 셀이 아니라 `<cols><col min max hidden>`에 구간으로 적는다
 * (min·max는 1-based 양끝 포함). 넓은 시트를 보기 좋게 접어두는 용도로 흔히
 * 쓰여, 행 숨김보다 오히려 자주 나타난다.
 */
function collectHiddenCols(worksheet: Record<string, unknown>): Set<number> {
  const hidden = new Set<number>();
  const cols = (worksheet.cols ?? {}) as Record<string, unknown>;

  for (const col of toArray(
    cols.col as Array<Record<string, unknown>> | undefined,
  )) {
    if (String(col["@_hidden"] ?? "") !== "1") continue;
    const min = Number(col["@_min"]);
    const max = Number(col["@_max"]);
    if (!Number.isInteger(min) || !Number.isInteger(max)) continue;
    for (let c = min; c <= max; c += 1) hidden.add(c - 1);
  }
  return hidden;
}

function collectHyperlinks(
  worksheet: Record<string, unknown>,
): Map<string, string> {
  const links = new Map<string, string>();
  const hyperlinks = (worksheet.hyperlinks ?? {}) as Record<string, unknown>;

  for (const link of toArray(
    hyperlinks.hyperlink as Array<Record<string, unknown>> | undefined,
  )) {
    const pos = parseCellRef(String(link["@_ref"] ?? ""));
    const relId = link["@_id"];
    if (!pos || relId === undefined) continue;
    links.set(cellKey(pos.row, pos.col), String(relId));
  }
  return links;
}

/** mergeCells의 "A1:C2" 목록을 공용 병합 맵으로 편다 */
function collectMerges(worksheet: Record<string, unknown>): {
  spans: Map<string, CellSpan>;
  covered: Set<string>;
} {
  const mergeCells = (worksheet.mergeCells ?? {}) as Record<string, unknown>;
  const ranges: Array<{
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  }> = [];

  for (const merge of toArray(
    mergeCells.mergeCell as Array<Record<string, unknown>> | undefined,
  )) {
    const [startRef = "", endRef = ""] = String(merge["@_ref"] ?? "").split(
      ":",
    );
    const start = parseCellRef(startRef);
    const end = parseCellRef(endRef);
    if (!start || !end) continue;
    ranges.push({
      startRow: start.row,
      endRow: end.row,
      startCol: start.col,
      endCol: end.col,
    });
  }
  return buildMergeMaps(ranges);
}

interface SparseRows {
  /** 행 인덱스 → (열 인덱스 → 텍스트). 빈 셀은 담지 않는다 */
  readonly rowsByIndex: Map<number, Map<number, string>>;
  readonly hiddenRows: Set<number>;
  readonly maxRow: number;
  readonly maxCol: number;
}

/** 행 하나의 셀들을 (열 인덱스 → 텍스트)로 모은다 */
function parseRowCells(
  row: Record<string, unknown>,
  ctx: CellContext,
): { cells: Map<number, string>; maxCol: number } {
  const cells = new Map<number, string>();
  let maxCol = -1;
  let fallbackCol = 0;

  for (const cell of toArray(
    row.c as Array<Record<string, unknown>> | undefined,
  )) {
    const pos = parseCellRef(String(cell["@_r"] ?? ""));
    const colIndex = pos ? pos.col : fallbackCol;
    fallbackCol = colIndex + 1;

    const text = cellText(cell, ctx);
    if (text !== "") cells.set(colIndex, text);
    if (colIndex > maxCol) maxCol = colIndex;
  }
  return { cells, maxCol };
}

/**
 * sheetData의 행들을 희소 표현으로 읽는다.
 * 엑셀은 빈 행·열을 아예 쓰지 않으므로 r 속성이 실제 위치의 근거다.
 */
function parseSheetRows(
  sheetData: Record<string, unknown>,
  ctx: CellContext,
): SparseRows {
  const rowsByIndex = new Map<number, Map<number, string>>();
  const hiddenRows = new Set<number>();
  let maxRow = -1;
  let maxCol = -1;
  let fallbackRow = 0;

  for (const row of toArray(
    sheetData.row as Array<Record<string, unknown>> | undefined,
  )) {
    const declared = Number(row["@_r"]);
    const rowIndex = Number.isInteger(declared) ? declared - 1 : fallbackRow;
    fallbackRow = rowIndex + 1;
    if (String(row["@_hidden"] ?? "") === "1") hiddenRows.add(rowIndex);

    const parsed = parseRowCells(row, ctx);
    rowsByIndex.set(rowIndex, parsed.cells);
    if (parsed.maxCol > maxCol) maxCol = parsed.maxCol;
    if (rowIndex > maxRow) maxRow = rowIndex;
  }

  return { rowsByIndex, hiddenRows, maxRow, maxCol };
}

/** 워크시트 XML을 셀 격자로 편다 */
export function parseWorksheet(
  xml: string,
  sharedStrings: ReadonlyArray<string>,
  formats: NumberFormats,
  date1904: boolean,
): SheetGrid {
  const doc = worksheetParser.parse(xml) as Record<string, unknown>;
  const worksheet = (doc.worksheet ?? {}) as Record<string, unknown>;
  const sheetData = (worksheet.sheetData ?? {}) as Record<string, unknown>;

  const parsed = parseSheetRows(sheetData, {
    sharedStrings,
    formats,
    date1904,
  });
  const { spans, covered } = collectMerges(worksheet);
  const { maxRow, maxCol } = extendBounds(parsed, [
    ...spans.keys(),
    ...covered,
  ]);
  const cells = toDenseGrid(parsed.rowsByIndex, maxRow, maxCol);
  const drawing = (worksheet.drawing ?? null) as Record<string, unknown> | null;

  return {
    cells,
    spans,
    covered,
    hiddenRows: parsed.hiddenRows,
    hiddenCols: collectHiddenCols(worksheet),
    hyperlinkRels: collectHyperlinks(worksheet),
    drawingRelId: drawing ? String(drawing["@_id"] ?? "") || null : null,
  };
}
