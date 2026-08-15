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
