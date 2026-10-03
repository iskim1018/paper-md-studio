import type { TableLayout } from "./table-chunks";

/**
 * 묶음으로 나눈 표의 열 너비·높이 추정.
 *
 * 묶음마다 별도 `<table>` 이므로 자동 너비로 두면 묶음마다 열 폭이 달라
 * 표가 들쭉날쭉해진다. 그래서 표 **전체** 내용으로 열 폭을 한 번 정해 모든
 * 묶음에 같은 `<colgroup>` 을 준다 (`table-layout: fixed`). 화면 밖 묶음의
 * 자리 크기(`contain-intrinsic-size`)도 여기서 어림한다 — 실제로 그려지면
 * 브라우저가 진짜 높이를 기억하므로(`auto`) 어림값은 스크롤바 길이에만 쓰인다.
 *
 * 폭은 글자 수로 어림한다. 한글·한자·전각은 1em, 그 밖은 0.55em 으로 센다.
 * 글꼴 측정(canvas)을 쓰지 않는 이유: Worker 에서도 돌아야 하고, 셀 수만큼
 * 재면 그게 다시 병목이 된다.
 */

export interface TableSizingOptions {
  /** 본문 글꼴 크기(px) */
  readonly fontPx: number;
  /** 셀 좌우 여백 + 테두리 합(px) */
  readonly horizontalPaddingPx: number;
  /** 셀 위아래 여백 + 테두리 합(px) */
  readonly verticalPaddingPx: number;
  readonly lineHeightPx: number;
  readonly minColumnPx: number;
  readonly maxColumnPx: number;
}

/** 셀의 줄 목록 (`<br>` 기준으로 나눈 텍스트) */
export type CellLines = (
  row: number,
  cellIndex: number,
) => ReadonlyArray<string>;

const WIDE_CHAR_EM = 1;
const NARROW_CHAR_EM = 0.55;

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
    (code >= 0x2e80 && code <= 0x9fff) || // CJK 부호·한자·가나·호환 자모
    (code >= 0xac00 && code <= 0xd7af) || // 한글 음절
    (code >= 0xf900 && code <= 0xfaff) || // CJK 호환 한자
    (code >= 0xff00 && code <= 0xff60) || // 전각 ASCII
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/** 글자 폭을 em 단위로 어림한다 */
export function textWidthEm(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += isWideCodePoint(code) ? WIDE_CHAR_EM : NARROW_CHAR_EM;
  }
  return width;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 열마다 가장 긴 줄에 맞춘 폭(상·하한 적용). 여러 열을 합친 셀은 폭 계산에서
 * 뺀다 — 합친 셀 하나 때문에 열 전체가 넓어지는 것을 막는다.
 */
export function estimateColumnWidths(
  layout: TableLayout,
  lines: CellLines,
  options: TableSizingOptions,
): ReadonlyArray<number> {
  const widestEm = new Array<number>(layout.columnCount).fill(0);
  for (const row of layout.cells) {
    for (const cell of row) {
      if (cell.colSpan !== 1) continue;
      for (const line of lines(cell.row, cell.cellIndex)) {
        const em = textWidthEm(line);
        if (em > (widestEm[cell.col] ?? 0)) widestEm[cell.col] = em;
      }
    }
  }
  return widestEm.map((em) =>
    Math.round(
      clamp(
        em * options.fontPx + options.horizontalPaddingPx,
        options.minColumnPx,
        options.maxColumnPx,
      ),
    ),
  );
}

/**
 * 행마다 높이를 어림한다 — 셀 폭에 맞춰 줄바꿈되는 줄 수 중 가장 큰 값.
 * 여러 행을 합친 셀은 높이를 나눠 갖기 때문에 빼고 센다.
 */
export function estimateRowHeights(
  layout: TableLayout,
  lines: CellLines,
  columnWidths: ReadonlyArray<number>,
  options: TableSizingOptions,
): ReadonlyArray<number> {
  return layout.cells.map((row) => {
    let maxLines = 1;
    for (const cell of row) {
      if (cell.rowSpan !== 1) continue;
      let width = 0;
      for (let c = cell.col; c < cell.col + cell.colSpan; c += 1) {
        width += columnWidths[c] ?? options.minColumnPx;
      }
      const innerPx = Math.max(1, width - options.horizontalPaddingPx);
      let cellLines = 0;
      for (const line of lines(cell.row, cell.cellIndex)) {
        const px = textWidthEm(line) * options.fontPx;
        cellLines += Math.max(1, Math.ceil(px / innerPx));
      }
      maxLines = Math.max(maxLines, cellLines);
    }
    return Math.round(
      maxLines * options.lineHeightPx + options.verticalPaddingPx,
    );
  });
}

/** px 값 합 — 묶음 폭(열 폭 합)·묶음 자리 높이(행 높이 합) */
export function sumPx(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0);
}
