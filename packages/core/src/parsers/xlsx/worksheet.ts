import { XMLParser } from "fast-xml-parser";
import type { NumberFormats } from "./cell-format.js";
import { formatCellValue } from "./cell-format.js";

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

export interface CellSpan {
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface SheetGrid {
  /** [행][열] 셀 텍스트. 빈 셀은 "" */
  readonly cells: ReadonlyArray<ReadonlyArray<string>>;
  /** "행,열" → 병합 크기 (좌상단 셀에만 있음) */
  readonly spans: ReadonlyMap<string, CellSpan>;
  /** 병합에 가려지는 자리 ("행,열") */
  readonly covered: ReadonlySet<string>;
  /** 숨김 처리된 행 인덱스 (0-based) */
  readonly hiddenRows: ReadonlySet<number>;
  /** 셀 위치 → 하이퍼링크 관계 ID */
  readonly hyperlinkRels: ReadonlyMap<string, string>;
  /** 시트에 붙은 그림(drawing) 관계 ID */
  readonly drawingRelId: string | null;
}

/** "B12" → {row: 11, col: 1} (0-based) */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!match) return null;
  const [, letters = "", digits = ""] = match;
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: Number(digits) - 1, col: col - 1 };
}

const key = (row: number, col: number): string => `${row},${col}`;

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

function collectMerges(worksheet: Record<string, unknown>): {
  spans: Map<string, CellSpan>;
  covered: Set<string>;
} {
  const spans = new Map<string, CellSpan>();
  const covered = new Set<string>();
  const mergeCells = (worksheet.mergeCells ?? {}) as Record<string, unknown>;

  for (const merge of toArray(
    mergeCells.mergeCell as Array<Record<string, unknown>> | undefined,
  )) {
    const ref = String(merge["@_ref"] ?? "");
    const [startRef = "", endRef = ""] = ref.split(":");
    const start = parseCellRef(startRef);
    const end = parseCellRef(endRef);
    if (!start || !end) continue;

    spans.set(key(start.row, start.col), {
      colSpan: end.col - start.col + 1,
      rowSpan: end.row - start.row + 1,
    });
    for (let r = start.row; r <= end.row; r += 1) {
      for (let c = start.col; c <= end.col; c += 1) {
        if (r === start.row && c === start.col) continue;
        covered.add(key(r, c));
      }
    }
  }
  return { spans, covered };
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
    links.set(key(pos.row, pos.col), String(relId));
  }
  return links;
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
  const ctx: CellContext = { sharedStrings, formats, date1904 };

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

    const cellsInRow = new Map<number, string>();
    let fallbackCol = 0;
    for (const cell of toArray(
      row.c as Array<Record<string, unknown>> | undefined,
    )) {
      const pos = parseCellRef(String(cell["@_r"] ?? ""));
      const colIndex = pos ? pos.col : fallbackCol;
      fallbackCol = colIndex + 1;
      const text = cellText(cell, ctx);
      if (text !== "") cellsInRow.set(colIndex, text);
      if (colIndex > maxCol) maxCol = colIndex;
    }
    rowsByIndex.set(rowIndex, cellsInRow);
    if (rowIndex > maxRow) maxRow = rowIndex;
  }

  const { spans, covered } = collectMerges(worksheet);
  for (const spanKey of [...spans.keys(), ...covered]) {
    const [r = "0", c = "0"] = spanKey.split(",");
    maxRow = Math.max(maxRow, Number(r));
    maxCol = Math.max(maxCol, Number(c));
  }

  const cells: Array<Array<string>> = [];
  for (let r = 0; r <= maxRow; r += 1) {
    const source = rowsByIndex.get(r);
    const row: Array<string> = [];
    for (let c = 0; c <= maxCol; c += 1) {
      row.push(source?.get(c) ?? "");
    }
    cells.push(row);
  }

  const drawing = (worksheet.drawing ?? null) as Record<string, unknown> | null;

  return {
    cells,
    spans,
    covered,
    hiddenRows,
    hyperlinkRels: collectHyperlinks(worksheet),
    drawingRelId: drawing ? String(drawing["@_id"] ?? "") || null : null,
  };
}
