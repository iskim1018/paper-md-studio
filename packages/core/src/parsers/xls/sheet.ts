import type { NumberFormats } from "../spreadsheet/cell-format.js";
import { formatCellValue } from "../spreadsheet/cell-format.js";
import type { SheetGrid } from "../spreadsheet/grid.js";
import {
  buildMergeMaps,
  extendBounds,
  toDenseGrid,
} from "../spreadsheet/grid.js";
import { decodeRk, REC, Reader, readRecords } from "./records.js";
import { readUnicodeString } from "./strings.js";

/**
 * 시트 스트림(BOF~EOF) → 셀 격자.
 *
 * XLSX가 셀마다 타입 속성을 두는 것과 달리, BIFF는 **레코드 종류 자체가 타입**이다
 * (NUMBER는 숫자, LABELSST는 공유 문자열, RK는 압축 실수…). 그래서 XLSX에서
 * 문제였던 "타입 속성 생략" 같은 함정은 없지만, 종류별로 다 읽어야 한다.
 */

export interface XlsSheetContext {
  readonly sharedStrings: ReadonlyArray<string>;
  readonly formats: NumberFormats;
  readonly date1904: boolean;
}

interface CellRef {
  readonly row: number;
  readonly col: number;
  readonly xf: number;
}

function readCellHeader(reader: Reader): CellRef {
  return { row: reader.u16(), col: reader.u16(), xf: reader.u16() };
}

/** XF 인덱스 → 표시형식을 적용한 문자열 */
function formatNumeric(
  value: number,
  xf: number,
  ctx: XlsSheetContext,
): string {
  const formatId = ctx.formats.xfFormatIds[xf] ?? 0;
  return formatCellValue(
    String(value),
    formatId,
    ctx.formats.customFormats,
    ctx.date1904,
  );
}

const ERROR_TEXT = new Map<number, string>([
  [0x00, "#NULL!"],
  [0x07, "#DIV/0!"],
  [0x0f, "#VALUE!"],
  [0x17, "#REF!"],
  [0x1d, "#NAME?"],
  [0x24, "#NUM!"],
  [0x2a, "#N/A"],
]);

interface MergeRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

interface SheetAccumulator {
  readonly rowsByIndex: Map<number, Map<number, string>>;
  readonly hiddenRows: Set<number>;
  readonly hiddenCols: Set<number>;
  readonly merges: Array<MergeRange>;
  maxRow: number;
  maxCol: number;
  /** 직전 FORMULA가 문자열 결과를 예고했을 때의 좌표 */
  pendingStringCell: { row: number; col: number } | null;
}

function put(
  acc: SheetAccumulator,
  row: number,
  col: number,
  text: string,
): void {
  if (text === "") return;
  let cells = acc.rowsByIndex.get(row);
  if (!cells) {
    cells = new Map<number, string>();
    acc.rowsByIndex.set(row, cells);
  }
  cells.set(col, text);
  if (row > acc.maxRow) acc.maxRow = row;
  if (col > acc.maxCol) acc.maxCol = col;
}

/** ROW 레코드: 숨김 플래그 (bit 5) */
function handleRow(data: Uint8Array, acc: SheetAccumulator): void {
  const reader = new Reader(data);
  const row = reader.u16();
  reader.skip(10); // 첫/마지막 열, 높이, 예약 2개
  const flags = reader.u16();
  if ((flags & 0x0020) !== 0) acc.hiddenRows.add(row);
  if (row > acc.maxRow) acc.maxRow = row;
}

/** COLINFO: 열 구간의 숨김 플래그 (bit 0) */
function handleColInfo(data: Uint8Array, acc: SheetAccumulator): void {
  const reader = new Reader(data);
  const first = reader.u16();
  const last = reader.u16();
  reader.u16(); // 너비
  reader.u16(); // XF
  const flags = reader.u16();
  if ((flags & 0x0001) === 0) return;
  for (let c = first; c <= last && c < 16384; c += 1) acc.hiddenCols.add(c);
}

function handleMerges(data: Uint8Array, acc: SheetAccumulator): void {
  const reader = new Reader(data);
  const count = reader.u16();
  for (let i = 0; i < count && reader.remaining >= 8; i += 1) {
    acc.merges.push({
      startRow: reader.u16(),
      endRow: reader.u16(),
      startCol: reader.u16(),
      endCol: reader.u16(),
    });
  }
}

/** MULRK: 한 행의 연속된 RK 셀 묶음 */
function handleMulRk(
  data: Uint8Array,
  acc: SheetAccumulator,
  ctx: XlsSheetContext,
): void {
  const reader = new Reader(data);
  const row = reader.u16();
  let col = reader.u16();
  // 끝 2바이트는 마지막 열 번호
  while (reader.remaining > 2) {
    const xf = reader.u16();
    const value = decodeRk(reader.i32());
    put(acc, row, col, formatNumeric(value, xf, ctx));
    col += 1;
  }
}

/** FORMULA의 캐시된 결과 8바이트 해석 */
function handleFormula(
  reader: Reader,
  acc: SheetAccumulator,
  ctx: XlsSheetContext,
): void {
  const { row, col, xf } = readCellHeader(reader);
  const low = reader.u32();
  const high = reader.u16();
  const marker = reader.u16();

  // 상위 2바이트가 0xFFFF면 숫자가 아닌 결과(문자열·오류·불리언)다
  if (marker !== 0xffff) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, low, true);
    view.setUint16(4, high, true);
    view.setUint16(6, marker, true);
    put(acc, row, col, formatNumeric(view.getFloat64(0, true), xf, ctx));
    return;
  }

  const kind = low & 0xff;
  const payload = (low >> 8) & 0xff;
  if (kind === 0x00) {
    // 문자열 결과 — 바로 뒤 STRING 레코드에 실려 온다
    acc.pendingStringCell = { row, col };
  } else if (kind === 0x01) {
    put(acc, row, col, payload === 1 ? "TRUE" : "FALSE");
  } else if (kind === 0x02) {
    put(acc, row, col, ERROR_TEXT.get(payload) ?? "#ERR!");
  }
}

function handleCellRecord(
  id: number,
  data: Uint8Array,
  acc: SheetAccumulator,
  ctx: XlsSheetContext,
): void {
  const reader = new Reader(data);

  switch (id) {
    case REC.NUMBER: {
      const { row, col, xf } = readCellHeader(reader);
      put(acc, row, col, formatNumeric(reader.f64(), xf, ctx));
      break;
    }
    case REC.RK: {
      const { row, col, xf } = readCellHeader(reader);
      put(acc, row, col, formatNumeric(decodeRk(reader.i32()), xf, ctx));
      break;
    }
    case REC.LABELSST: {
      const { row, col } = readCellHeader(reader);
      put(acc, row, col, ctx.sharedStrings[reader.u32()] ?? "");
      break;
    }
    case REC.LABEL: {
      const { row, col } = readCellHeader(reader);
      put(acc, row, col, readUnicodeString(reader));
      break;
    }
    case REC.BOOLERR: {
      const { row, col } = readCellHeader(reader);
      const value = reader.u8();
      const isError = reader.u8() === 1;
      const text = isError
        ? (ERROR_TEXT.get(value) ?? "#ERR!")
        : value === 1
          ? "TRUE"
          : "FALSE";
      put(acc, row, col, text);
      break;
    }
    case REC.FORMULA:
      handleFormula(reader, acc, ctx);
      break;
    case REC.STRING: {
      // 직전 FORMULA의 문자열 결과
      if (!acc.pendingStringCell) break;
      const { row, col } = acc.pendingStringCell;
      put(acc, row, col, readUnicodeString(reader));
      acc.pendingStringCell = null;
      break;
    }
    default:
      break;
  }
}

/** 시트 하나를 격자로 편다 */
export function parseSheet(
  stream: Uint8Array,
  offset: number,
  ctx: XlsSheetContext,
): SheetGrid {
  const acc: SheetAccumulator = {
    rowsByIndex: new Map(),
    hiddenRows: new Set(),
    hiddenCols: new Set(),
    merges: [],
    maxRow: -1,
    maxCol: -1,
    pendingStringCell: null,
  };

  for (const record of readRecords(stream.subarray(offset))) {
    if (record.id === REC.EOF) break;

    switch (record.id) {
      case REC.ROW:
        handleRow(record.data, acc);
        break;
      case REC.COLINFO:
        handleColInfo(record.data, acc);
        break;
      case REC.MERGEDCELLS:
        handleMerges(record.data, acc);
        break;
      case REC.MULRK:
        handleMulRk(record.data, acc, ctx);
        break;
      default:
        handleCellRecord(record.id, record.data, acc, ctx);
        break;
    }
  }

  const { spans, covered } = buildMergeMaps(acc.merges);
  const { maxRow, maxCol } = extendBounds(acc, [...spans.keys(), ...covered]);
  const cells = toDenseGrid(acc.rowsByIndex, maxRow, maxCol);

  return {
    cells,
    spans,
    covered,
    hiddenRows: acc.hiddenRows,
    hiddenCols: acc.hiddenCols,
    hyperlinkRels: new Map<string, string>(),
    drawingRelId: null,
  };
}
