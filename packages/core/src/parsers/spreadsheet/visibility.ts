import type { CellSpan, SheetGrid } from "./grid.js";

/**
 * 숨긴 행·열을 걷어내고 격자를 다시 투영한다.
 *
 * 숨김의 의도는 두 가지다 — 대외비 은닉이거나, 단순히 "열이 많아 보기 불편해서"
 * 접어둔 것이거나. 우리가 대신 판단할 수 없으므로 사용자가 고르게 하고
 * (`xlsx.includeHidden`), 여기서는 선택을 격자에 반영하는 일만 한다.
 *
 * 어려운 부분은 병합이다. 병합 범위가 숨김과 겹치면 span을 다시 세지 않는 한
 * 표의 열 수가 어긋난다. 시작 셀이 숨겨진 경우엔 내용을 첫 보이는 자리로
 * 옮긴다 — 그러지 않으면 보이는 칸만 남고 값이 통째로 사라진다.
 */

export interface VisibleGrid {
  readonly cells: ReadonlyArray<ReadonlyArray<string>>;
  readonly spans: ReadonlyMap<string, CellSpan>;
  readonly covered: ReadonlySet<string>;
  readonly hyperlinkRels: ReadonlyMap<string, string>;
  /**
   * 살아남은 것 중 원본에서 숨김이었던 행·열 (투영 후 인덱스).
   * 제외한 경우에는 비어 있다. 원본 뷰어가 "이건 숨겨져 있던 자리"라고
   * 표시하는 데 쓴다 — 무엇이 감춰져 있었는지 눈으로 봐야 포함 여부를
   * 판단할 수 있다.
   */
  readonly hiddenRows: ReadonlySet<number>;
  readonly hiddenCols: ReadonlySet<number>;
}

const key = (row: number, col: number): string => `${row},${col}`;

/** 원래 인덱스 → 투영 후 인덱스 (숨겨진 자리는 없음) */
function buildIndexMap(
  total: number,
  hidden: ReadonlySet<number>,
  includeHidden: boolean,
): Map<number, number> {
  const map = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < total; i += 1) {
    if (!includeHidden && hidden.has(i)) continue;
    map.set(i, next);
    next += 1;
  }
  return map;
}

/** 병합 범위 안에서 살아남은 행·열의 투영 인덱스 */
function visibleIndicesInRange(
  start: number,
  length: number,
  map: ReadonlyMap<number, number>,
): Array<number> {
  const result: Array<number> = [];
  for (let i = start; i < start + length; i += 1) {
    const mapped = map.get(i);
    if (mapped !== undefined) result.push(mapped);
  }
  return result;
}

interface ProjectedSpan {
  readonly anchor: { row: number; col: number };
  readonly span: CellSpan;
  readonly text: string;
}

/** 병합 하나를 투영한다. 범위 전체가 숨겨졌으면 null */
function projectSpan(
  position: string,
  span: CellSpan,
  grid: SheetGrid,
  rowMap: ReadonlyMap<number, number>,
  colMap: ReadonlyMap<number, number>,
): ProjectedSpan | null {
  const [rawRow = "0", rawCol = "0"] = position.split(",");
  const row = Number(rawRow);
  const col = Number(rawCol);

  const rows = visibleIndicesInRange(row, span.rowSpan, rowMap);
  const cols = visibleIndicesInRange(col, span.colSpan, colMap);
  const anchorRow = rows[0];
  const anchorCol = cols[0];
  if (anchorRow === undefined || anchorCol === undefined) return null;

  return {
    anchor: { row: anchorRow, col: anchorCol },
    span: { colSpan: cols.length, rowSpan: rows.length },
    text: grid.cells[row]?.[col] ?? "",
  };
}

/** 숨김 선택을 반영해 격자·병합·하이퍼링크를 다시 매긴다 */
export function projectVisibleGrid(
  grid: SheetGrid,
  includeHidden: boolean,
): VisibleGrid {
  const totalRows = grid.cells.length;
  const totalCols = grid.cells[0]?.length ?? 0;
  const rowMap = buildIndexMap(totalRows, grid.hiddenRows, includeHidden);
  const colMap = buildIndexMap(totalCols, grid.hiddenCols, includeHidden);

  const cells: Array<Array<string>> = Array.from({ length: rowMap.size }, () =>
    Array.from({ length: colMap.size }, () => ""),
  );
  for (const [originalRow, newRow] of rowMap) {
    for (const [originalCol, newCol] of colMap) {
      const target = cells[newRow];
      if (target) target[newCol] = grid.cells[originalRow]?.[originalCol] ?? "";
    }
  }

  const { spans, covered } = applyProjectedSpans(grid, cells, rowMap, colMap);
  const hyperlinkRels = remapHyperlinks(grid, rowMap, colMap);

  return {
    cells,
    spans,
    covered,
    hyperlinkRels,
    hiddenRows: projectIndices(grid.hiddenRows, rowMap),
    hiddenCols: projectIndices(grid.hiddenCols, colMap),
  };
}

/** 숨김 인덱스를 투영 후 좌표로 옮긴다 (제외됐으면 자연히 빠진다) */
function projectIndices(
  hidden: ReadonlySet<number>,
  map: ReadonlyMap<number, number>,
): Set<number> {
  const projected = new Set<number>();
  for (const index of hidden) {
    const mapped = map.get(index);
    if (mapped !== undefined) projected.add(mapped);
  }
  return projected;
}

/** 투영된 병합을 격자에 반영하고 span·covered를 만든다 */
function applyProjectedSpans(
  grid: SheetGrid,
  cells: Array<Array<string>>,
  rowMap: ReadonlyMap<number, number>,
  colMap: ReadonlyMap<number, number>,
): { spans: Map<string, CellSpan>; covered: Set<string> } {
  const spans = new Map<string, CellSpan>();
  const covered = new Set<string>();

  for (const [position, span] of grid.spans) {
    const projected = projectSpan(position, span, grid, rowMap, colMap);
    if (!projected) continue;

    const { anchor, span: newSpan, text } = projected;
    // 시작 셀이 숨겨졌던 경우 내용이 새 자리에 없으므로 옮겨 심는다
    const anchorRow = cells[anchor.row];
    if (anchorRow) anchorRow[anchor.col] = text;

    if (newSpan.colSpan > 1 || newSpan.rowSpan > 1) {
      spans.set(key(anchor.row, anchor.col), newSpan);
    }
    markCovered(anchor, newSpan, covered);
  }
  return { spans, covered };
}

function markCovered(
  anchor: { row: number; col: number },
  span: CellSpan,
  covered: Set<string>,
): void {
  for (let r = anchor.row; r < anchor.row + span.rowSpan; r += 1) {
    for (let c = anchor.col; c < anchor.col + span.colSpan; c += 1) {
      if (r === anchor.row && c === anchor.col) continue;
      covered.add(key(r, c));
    }
  }
}

/** 하이퍼링크 위치를 투영 후 좌표로 다시 매긴다 (숨겨진 자리는 버린다) */
function remapHyperlinks(
  grid: SheetGrid,
  rowMap: ReadonlyMap<number, number>,
  colMap: ReadonlyMap<number, number>,
): Map<string, string> {
  const hyperlinkRels = new Map<string, string>();
  for (const [position, relId] of grid.hyperlinkRels) {
    const [rawRow = "0", rawCol = "0"] = position.split(",");
    const newRow = rowMap.get(Number(rawRow));
    const newCol = colMap.get(Number(rawCol));
    if (newRow === undefined || newCol === undefined) continue;
    hyperlinkRels.set(key(newRow, newCol), relId);
  }
  return hyperlinkRels;
}
