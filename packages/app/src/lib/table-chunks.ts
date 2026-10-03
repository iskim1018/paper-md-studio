/**
 * 큰 표를 행 묶음(chunk)으로 나누는 계획.
 *
 * 수천 행짜리 표 하나를 그대로 그리면 브라우저가 표 전체를 한 번에 배치한다
 * (실물 엑셀 5,900행: 레이아웃만 1.7초). 표를 행 묶음마다 별도 `<table>` 로
 * 나누고 묶음에 `content-visibility: auto` 를 걸면 화면 밖 묶음의 배치·그리기를
 * 브라우저가 건너뛴다. DOM 은 그대로 남으므로 텍스트 검색·`scrollIntoView` 는
 * 손댈 필요가 없다.
 *
 * 나누는 순간 깨지는 것이 세로 병합(rowspan)이다. 묶음 경계를 넘는 병합은
 * 앞 묶음에서는 남은 행 수로 줄이고, 뒤 묶음 첫 행에는 같은 열 위치에 빈
 * **이어지는 칸**을 넣는다 — 그래야 뒤 묶음의 다른 셀이 왼쪽으로 당겨지지
 * 않는다.
 *
 * 이 파일은 DOM·hast 어느 쪽에도 기대지 않는 순수 계산만 한다. 원본 뷰어(DOM)와
 * 결과 미리보기(hast)가 같은 계획을 쓴다.
 */

/** 묶음 하나에 담는 행 수 */
export const TABLE_CHUNK_ROWS = 100;

/**
 * 이 행 수를 넘는 표만 나눈다. 작은 표는 지금처럼 자동 너비로 그린다 —
 * 나누면 열 너비를 고정해야 해서 모양이 미세하게 달라지기 때문이다.
 */
export const TABLE_CHUNK_MIN_ROWS = TABLE_CHUNK_ROWS * 2;

/**
 * 열이 이보다 많은 표는 나누지 않는다. 열 폭 표(colgroup)를 묶음마다 복제하므로
 * 비정상적으로 넓은 표(거대 colspan 등)에서는 오히려 비용이 커진다. 엑셀
 * 변환기가 시트를 200열로 자르므로 실제 표는 이 안에 든다.
 */
export const TABLE_CHUNK_MAX_COLUMNS = 256;

/** HTML 규격의 span 상한 — 브라우저도 이 값으로 자른다 */
const MAX_COL_SPAN = 1000;
const MAX_ROW_SPAN = 65534;

export interface CellSpan {
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** 원래 행의 셀 하나 (span 을 묶음 안으로 줄인 값) */
export interface PlannedOwnCell {
  readonly kind: "own";
  /** 원래 행 안에서의 셀 순번 */
  readonly cellIndex: number;
  readonly rowSpan: number;
  /** 이 셀의 병합이 묶음 끝에서 잘려 다음 묶음으로 이어지는가 */
  readonly continuesBelow: boolean;
}

/** 앞 묶음에서 시작한 병합이 이 묶음으로 이어지는 빈 칸 */
export interface PlannedContinuation {
  readonly kind: "continuation";
  readonly sourceRow: number;
  readonly sourceCell: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly continuesBelow: boolean;
}

/**
 * 원래 표에서 비어 있던 칸. 묶음 첫 행에서 이어지는 칸 **앞**에 빈 자리가 있으면
 * 브라우저가 이어지는 칸을 그 빈 자리로 당겨 넣으므로 자리를 채워 둔다.
 */
export interface PlannedFiller {
  readonly kind: "filler";
  readonly colSpan: number;
}

export type PlannedCell = PlannedOwnCell | PlannedContinuation | PlannedFiller;

export interface PlannedRow {
  /** 원래 표에서의 행 순번 */
  readonly rowIndex: number;
  readonly cells: ReadonlyArray<PlannedCell>;
}

export interface TableChunk {
  readonly start: number;
  readonly end: number;
  readonly rows: ReadonlyArray<PlannedRow>;
}

export interface PositionedCell {
  readonly row: number;
  readonly cellIndex: number;
  readonly col: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface TableLayout {
  readonly columnCount: number;
  /** 행마다 셀의 시작 열 위치 (원래 셀 순서) */
  readonly cells: ReadonlyArray<ReadonlyArray<PositionedCell>>;
}

interface ColumnEntry {
  readonly col: number;
  /** 차지하는 열 수 */
  readonly span: number;
  readonly planned: PlannedCell;
}

function clampSpan(value: number, max: number): number {
  return Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), max)
    : 1;
}

/**
 * HTML 표 배치 규칙대로 각 셀의 시작 열을 정한다 — 위에서 내려온 병합이
 * 차지한 칸을 건너뛰고 첫 빈 칸부터 채운다. rowspan 은 표 끝에서 잘리고,
 * `rowspan="0"` 은 표 끝까지다. span 은 HTML 규격 상한으로 자른다 — 정화를 거친
 * 원본 HTML 표라도 `colspan="1000000"` 은 그대로 들어올 수 있다 (브라우저와 같다).
 */
export function layoutTable(
  rows: ReadonlyArray<ReadonlyArray<CellSpan>>,
): TableLayout {
  const occupied: Array<Set<number>> = rows.map(() => new Set<number>());
  let columnCount = 0;

  const cells = rows.map((row, rowIndex) => {
    let col = 0;
    return row.map((cell, cellIndex): PositionedCell => {
      const colSpan = clampSpan(cell.colSpan, MAX_COL_SPAN);
      const remaining = rows.length - rowIndex;
      const rowSpan =
        cell.rowSpan === 0
          ? remaining
          : Math.min(clampSpan(cell.rowSpan, MAX_ROW_SPAN), remaining);
      while (occupied[rowIndex]?.has(col)) col += 1;
      for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) occupied[r]?.add(c);
      }
      const positioned = { row: rowIndex, cellIndex, col, colSpan, rowSpan };
      col += colSpan;
      columnCount = Math.max(columnCount, col);
      return positioned;
    });
  });

  return { columnCount, cells };
}

/**
 * 행들을 `chunkRows` 개씩 나누고, 경계를 넘는 병합을 다시 센다.
 *
 * 반환한 묶음의 행·셀을 순서대로 그리면 묶음마다 원래 표와 같은 열 위치가 된다.
 */
export function planTableChunks(
  layout: TableLayout,
  chunkRows: number = TABLE_CHUNK_ROWS,
): ReadonlyArray<TableChunk> {
  const size = Math.max(1, Math.floor(chunkRows));
  const rowCount = layout.cells.length;
  // 묶음마다 앞쪽 셀 전부를 훑지 않도록, 경계를 넘을 수 있는 병합만 추려 둔다
  const spanning = layout.cells.flat().filter((cell) => cell.rowSpan > 1);
  const chunks: Array<TableChunk> = [];

  for (let start = 0; start < rowCount; start += size) {
    const end = Math.min(start + size, rowCount);
    chunks.push({
      start,
      end,
      rows: planChunkRows(layout, spanning, start, end),
    });
  }
  return chunks;
}

function planChunkRows(
  layout: TableLayout,
  spanning: ReadonlyArray<PositionedCell>,
  start: number,
  end: number,
): ReadonlyArray<PlannedRow> {
  const rows: Array<PlannedRow> = [];
  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const own = (layout.cells[rowIndex] ?? []).map((cell): ColumnEntry => {
      const spanEnd = cell.row + cell.rowSpan;
      return {
        col: cell.col,
        span: cell.colSpan,
        planned: {
          kind: "own",
          cellIndex: cell.cellIndex,
          rowSpan: Math.min(spanEnd, end) - rowIndex,
          continuesBelow: spanEnd > end,
        },
      };
    });
    const carried =
      rowIndex === start && start > 0
        ? continuationsInto(spanning, start, end)
        : [];
    const merged = [...own, ...carried].sort((a, b) => a.col - b.col);
    rows.push({
      rowIndex,
      cells:
        carried.length > 0 ? withFillers(merged) : merged.map((e) => e.planned),
    });
  }
  return rows;
}

/**
 * 묶음 첫 행의 빈 열을 채운다. 첫 행 위에는 이 묶음의 행이 없으므로 열 사이의
 * 틈은 원래 표에서도 비어 있던 자리다.
 */
function withFillers(entries: ReadonlyArray<ColumnEntry>): Array<PlannedCell> {
  const cells: Array<PlannedCell> = [];
  let col = 0;
  for (const entry of entries) {
    if (entry.col > col) {
      cells.push({ kind: "filler", colSpan: entry.col - col });
    }
    cells.push(entry.planned);
    col = Math.max(col, entry.col + entry.span);
  }
  return cells;
}

/** `start` 앞에서 시작해 `start` 행까지 내려오는 병합들 */
function continuationsInto(
  spanning: ReadonlyArray<PositionedCell>,
  start: number,
  end: number,
): Array<ColumnEntry> {
  return spanning
    .filter((cell) => cell.row < start && cell.row + cell.rowSpan > start)
    .map((cell): ColumnEntry => {
      const spanEnd = cell.row + cell.rowSpan;
      return {
        col: cell.col,
        span: cell.colSpan,
        planned: {
          kind: "continuation",
          sourceRow: cell.row,
          sourceCell: cell.cellIndex,
          colSpan: cell.colSpan,
          rowSpan: Math.min(spanEnd, end) - start,
          continuesBelow: spanEnd > end,
        },
      };
    });
}
