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
  /** 셀 위치 → 하이퍼링크 (XLSX는 관계 ID, XLS는 URL) */
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
 * 안쪽(내용과 내용 사이)의 빈 행은 원본의 구획일 수 있으므로 남긴다 —
 * 바깥쪽만 자른다.
 */
/** 내용이 들어 있는 마지막 행·열 (0-based, 없으면 -1) */
function findContentBounds(grid: SheetGrid): {
  lastRow: number;
  lastCol: number;
} {
  let lastRow = -1;
  let lastCol = -1;

  const mark = (row: number, col: number): void => {
    if (row > lastRow) lastRow = row;
    if (col > lastCol) lastCol = col;
  };

  grid.cells.forEach((row, r) => {
    row.forEach((text, c) => {
      if (text !== "") mark(r, c);
    });
  });

  // 값 없이 링크만 걸린 셀도 내용이다 (렌더가 주소를 대신 보여준다)
  for (const position of grid.hyperlinkRels.keys()) {
    const [r = "0", c = "0"] = position.split(",");
    mark(Number(r), Number(c));
  }

  return { lastRow, lastCol };
}

/** 잘라낸 자리까지 뻗던 병합을 남은 크기로 다시 센다 */
function clampSpans(
  spans: ReadonlyMap<string, CellSpan>,
  rows: number,
  cols: number,
): Map<string, CellSpan> {
  const clamped = new Map<string, CellSpan>();
  for (const [position, span] of spans) {
    const [rawRow = "0", rawCol = "0"] = position.split(",");
    const row = Number(rawRow);
    const col = Number(rawCol);
    if (row >= rows || col >= cols) continue;
    clamped.set(position, {
      rowSpan: Math.min(span.rowSpan, rows - row),
      colSpan: Math.min(span.colSpan, cols - col),
    });
  }
  return clamped;
}

export function trimEmptyEdges(grid: SheetGrid): SheetGrid {
  const { lastRow, lastCol } = findContentBounds(grid);
  const rows = lastRow + 1;
  const cols = lastCol + 1;
  if (rows === grid.cells.length && cols === (grid.cells[0]?.length ?? 0)) {
    return grid;
  }

  const inBounds = (position: string): boolean => {
    const [r = "0", c = "0"] = position.split(",");
    return Number(r) < rows && Number(c) < cols;
  };

  return {
    cells: grid.cells.slice(0, rows).map((row) => row.slice(0, cols)),
    spans: clampSpans(grid.spans, rows, cols),
    covered: new Set([...grid.covered].filter(inBounds)),
    hiddenRows: new Set([...grid.hiddenRows].filter((r) => r < rows)),
    hiddenCols: new Set([...grid.hiddenCols].filter((c) => c < cols)),
    hyperlinkRels: new Map(
      [...grid.hyperlinkRels].filter(([position]) => inBounds(position)),
    ),
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
