/**
 * 스프레드시트 격자의 공용 표현.
 *
 * XLSX(XML)와 XLS(BIFF 바이너리)는 담는 방식만 다를 뿐 담기는 것은 같다.
 * 두 파서가 이 같은 모양으로 수렴한 뒤부터는 완전히 같은 코드로 렌더된다 —
 * 사용자에게 "같은 엑셀"인 파일이 확장자에 따라 다르게 나오면 안 된다.
 */

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
  /** 숨김 처리된 열 인덱스 (0-based) */
  readonly hiddenCols: ReadonlySet<number>;
  /** 셀 위치 → 하이퍼링크. 파서가 렌더 전에 실제 주소로 풀어 둔다 */
  readonly hyperlinkRels: ReadonlyMap<string, string>;
  /** 시트에 붙은 그림(drawing) 관계 ID. 없으면 null */
  readonly drawingRelId: string | null;
}

/** 격자 좌표 키 */
export const cellKey = (row: number, col: number): string => `${row},${col}`;

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

/** 희소 셀 맵을 빈 문자열로 채운 직사각 격자로 편다 */
export function toDenseGrid(
  rowsByIndex: ReadonlyMap<number, Map<number, string>>,
  maxRow: number,
  maxCol: number,
): Array<Array<string>> {
  const cells: Array<Array<string>> = [];
  for (let r = 0; r <= maxRow; r += 1) {
    const source = rowsByIndex.get(r);
    const row: Array<string> = [];
    for (let c = 0; c <= maxCol; c += 1) {
      row.push(source?.get(c) ?? "");
    }
    cells.push(row);
  }
  return cells;
}

/**
 * 내용이 없는 바깥쪽 행·열을 잘라낸다.
 *
 * "엑셀은 빈 행·열을 아예 쓰지 않는다"는 가정은 실물에서 깨진다. 행 높이나
 * 테두리만 지정해도 `<row>`가 생기고, LibreOffice로 저장한 파일은 내용과
 * 무관하게 1000행을 통째로 적어둔다 (실물 WBS 실측: 표지 시트의 실제 내용은
 * 26행인데 기록된 행은 1000행, 통합 문서 전체로는 표 6,164행 중 4,830행이
 * 꼬리쪽 빈 행이었다). 그대로 표로 만들면 빈 칸뿐인 줄이 수천 개 쌓여 토큰을
 * 먹고, 에디터를 멈춰 세운다.
 *
 * 앞쪽(위·왼쪽)도 같다. 한국 양식은 A열·1행을 여백으로 비워두는 일이 흔한데,
 * 남겨두면 모든 행 앞에 빈 칸이 붙고 표 머리가 빈 행이 된다.
 *
 * 안쪽(내용과 내용 사이)의 빈 행은 원본의 구획일 수 있으므로 남긴다 —
 * 바깥쪽만 자른다.
 */
export function trimEmptyEdges(grid: SheetGrid): SheetGrid {
  const bounds = findContentBounds(grid);
  if (!bounds) return emptyLike(grid);

  const { firstRow, lastRow, firstCol, lastCol } = bounds;
  const rows = lastRow - firstRow + 1;
  const cols = lastCol - firstCol + 1;
  if (
    firstRow === 0 &&
    firstCol === 0 &&
    rows === grid.cells.length &&
    cols === (grid.cells[0]?.length ?? 0)
  ) {
    return grid;
  }

  /** 원래 좌표 → 잘라낸 뒤 좌표 (범위 밖이면 null) */
  const shift = (position: string): string | null => {
    const { row, col } = splitKey(position);
    const r = row - firstRow;
    const c = col - firstCol;
    return r >= 0 && r < rows && c >= 0 && c < cols ? cellKey(r, c) : null;
  };

  const { spans, anchors } = clipSpans(grid.spans, bounds);
  const covered = new Set<string>();
  for (const position of grid.covered) {
    const moved = shift(position);
    // 앞쪽이 잘린 병합은 가려졌던 칸이 새 시작점이 된다
    if (moved !== null && !anchors.has(moved)) covered.add(moved);
  }

  return {
    cells: grid.cells
      .slice(firstRow, lastRow + 1)
      .map((row) => row.slice(firstCol, lastCol + 1)),
    spans,
    covered,
    hiddenRows: shiftIndices(grid.hiddenRows, firstRow, rows),
    hiddenCols: shiftIndices(grid.hiddenCols, firstCol, cols),
    hyperlinkRels: new Map(
      [...grid.hyperlinkRels].flatMap(([position, rel]) => {
        const moved = shift(position);
        return moved === null ? [] : [[moved, rel] as const];
      }),
    ),
    drawingRelId: grid.drawingRelId,
  };
}

const splitKey = (position: string): { row: number; col: number } => {
  const [r = "0", c = "0"] = position.split(",");
  return { row: Number(r), col: Number(c) };
};

/** 내용이 들어 있는 행·열 범위 (0-based 양끝 포함, 내용이 없으면 null) */
function findContentBounds(grid: SheetGrid): ContentBounds | null {
  let firstRow = Number.POSITIVE_INFINITY;
  let firstCol = Number.POSITIVE_INFINITY;
  let lastRow = -1;
  let lastCol = -1;

  const mark = (row: number, col: number): void => {
    firstRow = Math.min(firstRow, row);
    firstCol = Math.min(firstCol, col);
    lastRow = Math.max(lastRow, row);
    lastCol = Math.max(lastCol, col);
  };

  grid.cells.forEach((row, r) => {
    row.forEach((text, c) => {
      if (text !== "") mark(r, c);
    });
  });

  // 값 없이 링크만 걸린 셀도 내용이다 (렌더가 주소를 대신 보여준다)
  for (const position of grid.hyperlinkRels.keys()) {
    const { row, col } = splitKey(position);
    mark(row, col);
  }

  return lastRow < 0 ? null : { firstRow, lastRow, firstCol, lastCol };
}

interface ContentBounds {
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstCol: number;
  readonly lastCol: number;
}

/**
 * 병합을 남는 영역과 겹치는 부분으로 다시 센다.
 * 잘린 쪽으로 뻗던 병합은 크기가 줄고, 앞쪽이 잘린 병합은 시작점이 옮겨진다
 * (rowSpan을 그대로 두면 grid 정규화가 잘라낸 빈 행을 되살린다).
 */
function clipSpans(
  spans: ReadonlyMap<string, CellSpan>,
  bounds: ContentBounds,
): { spans: Map<string, CellSpan>; anchors: Set<string> } {
  const clipped = new Map<string, CellSpan>();
  const anchors = new Set<string>();
  for (const [position, span] of spans) {
    const { row, col } = splitKey(position);
    const top = Math.max(row, bounds.firstRow);
    const left = Math.max(col, bounds.firstCol);
    const bottom = Math.min(row + span.rowSpan - 1, bounds.lastRow);
    const right = Math.min(col + span.colSpan - 1, bounds.lastCol);
    if (top > bottom || left > right) continue;

    const key = cellKey(top - bounds.firstRow, left - bounds.firstCol);
    const rowSpan = bottom - top + 1;
    const colSpan = right - left + 1;
    anchors.add(key);
    // 한 칸으로 줄어든 병합은 더 이상 병합이 아니다
    if (rowSpan > 1 || colSpan > 1) clipped.set(key, { rowSpan, colSpan });
  }
  return { spans: clipped, anchors };
}

/** 인덱스 집합을 잘라낸 범위로 옮긴다 */
function shiftIndices(
  indices: ReadonlySet<number>,
  offset: number,
  size: number,
): Set<number> {
  return new Set(
    [...indices].map((i) => i - offset).filter((i) => i >= 0 && i < size),
  );
}

/** 내용이 없는 시트 — 표 없이 제목만 남긴다 */
function emptyLike(grid: SheetGrid): SheetGrid {
  return {
    cells: [],
    spans: new Map(),
    covered: new Set(),
    hiddenRows: new Set(),
    hiddenCols: new Set(),
    hyperlinkRels: new Map(),
    drawingRelId: grid.drawingRelId,
  };
}

/** 병합 좌표까지 포함해 격자 크기를 넓힌다 (병합만 있고 값은 없는 자리 대비) */
export function extendBounds(
  bounds: { maxRow: number; maxCol: number },
  positions: Iterable<string>,
): { maxRow: number; maxCol: number } {
  let { maxRow, maxCol } = bounds;
  for (const position of positions) {
    const [r = "0", c = "0"] = position.split(",");
    maxRow = Math.max(maxRow, Number(r));
    maxCol = Math.max(maxCol, Number(c));
  }
  return { maxRow, maxCol };
}

/** 병합 범위를 spans/covered로 편다 */
export function buildMergeMaps(
  ranges: ReadonlyArray<{
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  }>,
): { spans: Map<string, CellSpan>; covered: Set<string> } {
  const spans = new Map<string, CellSpan>();
  const covered = new Set<string>();

  for (const range of ranges) {
    if (range.endRow < range.startRow || range.endCol < range.startCol)
      continue;
    spans.set(cellKey(range.startRow, range.startCol), {
      colSpan: range.endCol - range.startCol + 1,
      rowSpan: range.endRow - range.startRow + 1,
    });
    for (let r = range.startRow; r <= range.endRow; r += 1) {
      for (let c = range.startCol; c <= range.endCol; c += 1) {
        if (r === range.startRow && c === range.startCol) continue;
        covered.add(cellKey(r, c));
      }
    }
  }
  return { spans, covered };
}
