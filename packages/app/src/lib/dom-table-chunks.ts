import {
  layoutTable,
  type PlannedCell,
  planTableChunks,
  TABLE_CHUNK_MAX_COLUMNS,
  TABLE_CHUNK_MIN_ROWS,
  TABLE_CHUNK_ROWS,
} from "./table-chunks";
import {
  estimateColumnWidths,
  estimateRowHeights,
  sumPx,
  type TableSizingOptions,
} from "./table-sizing";

/**
 * DOM 위의 큰 표를 행 묶음으로 다시 짠다 (원본 뷰어용).
 *
 * 묶음 계획·크기 어림은 `table-chunks`·`table-sizing` 이 하고, 여기서는 그
 * 계획대로 원래 `<tr>`·`<td>` 를 옮겨 담기만 한다 — 셀 요소를 새로 만들지
 * 않으므로 숨김 표시 클래스(`xlsx-hidden-*`)·링크·줄바꿈이 그대로 남는다.
 * 만드는 것은 경계를 넘는 병합의 **이어지는 칸**뿐이다.
 *
 * 결과 구조 (클래스는 styles.css 의 `.table-chunked` 규칙과 짝):
 *
 * ```
 * div.table-chunked
 *   div.table-chunk  (content-visibility: auto, 폭·자리 높이 지정)
 *     table  (table-layout: fixed, colgroup 으로 모든 묶음 같은 열 폭)
 * ```
 */

export const TABLE_CHUNKED_CLASS = "table-chunked";
export const TABLE_CHUNK_CLASS = "table-chunk";
/** 병합이 묶음 끝에서 잘린 셀 — 아래 테두리를 숨겨 이어 보이게 한다 */
export const SPAN_OPEN_CLASS = "table-span-open";
/** 앞 묶음에서 이어지는 빈 칸 — 위 테두리를 숨긴다 */
export const SPAN_CONTINUATION_CLASS = "table-span-cont";

interface ChunkOptions {
  readonly minRows?: number;
  readonly chunkRows?: number;
}

/** `<br>` 을 줄 경계로 보고 셀 텍스트를 줄로 나눈다 */
function cellLines(cell: Element): ReadonlyArray<string> {
  const lines: Array<string> = [""];
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        lines[lines.length - 1] += child.textContent ?? "";
      } else if (child.nodeName === "BR") {
        lines.push("");
      } else {
        walk(child);
      }
    }
  };
  walk(cell);
  return lines;
}

/** 다른 표 안에 들어 있지 않은 표만 — 중첩 표는 바깥 표와 함께 움직인다 */
function topLevelTables(root: ParentNode): Array<HTMLTableElement> {
  return Array.from(root.querySelectorAll("table")).filter(
    (table) => !table.parentElement?.closest("table"),
  );
}

/**
 * 묶음으로 나눌 수 있는 단순한 표인가. 행 구역(thead·tfoot·여러 tbody)이나
 * 캡션·기존 열 정의가 있으면 나누면서 의미가 바뀌므로 그대로 둔다 — 브라우저는
 * rowspan 을 행 구역 경계에서 자르고 tfoot 을 맨 아래에 그린다. 엑셀 뷰어가 받는
 * 표는 `<table><tr>…` 뿐이라 늘 해당한다.
 */
function isPlainTable(table: HTMLTableElement): boolean {
  return (
    table.tHead === null &&
    table.tFoot === null &&
    table.caption === null &&
    table.tBodies.length <= 1 &&
    table.querySelector(":scope > colgroup") === null
  );
}

/**
 * `root` 안에서 `minRows` 행을 넘는 표를 묶음으로 바꾼다. 바꾼 표 수를 돌려준다.
 * `root` 는 아직 화면에 붙지 않은(이 함수를 부르는 쪽이 소유한) 트리여야 한다.
 */
export function chunkLargeDomTables(
  root: ParentNode,
  sizing: TableSizingOptions,
  options: ChunkOptions = {},
): number {
  const minRows = options.minRows ?? TABLE_CHUNK_MIN_ROWS;
  const chunkRows = options.chunkRows ?? TABLE_CHUNK_ROWS;
  let chunked = 0;

  for (const table of topLevelTables(root)) {
    const rows = Array.from(table.rows);
    if (rows.length <= minRows || !isPlainTable(table)) continue;
    const chunkedTable = buildChunkedTable(table, rows, sizing, chunkRows);
    if (!chunkedTable) continue;
    table.replaceWith(chunkedTable);
    chunked += 1;
  }
  return chunked;
}

function buildChunkedTable(
  table: HTMLTableElement,
  rows: ReadonlyArray<HTMLTableRowElement>,
  sizing: TableSizingOptions,
  chunkRows: number,
): HTMLElement | null {
  const doc = table.ownerDocument;
  const cells = rows.map((row) => Array.from(row.cells));
  const layout = layoutTable(
    cells.map((row) =>
      row.map((cell) => ({ colSpan: cell.colSpan, rowSpan: cell.rowSpan })),
    ),
  );
  if (layout.columnCount > TABLE_CHUNK_MAX_COLUMNS) return null;
  const lineCache = cells.map((row) => row.map(cellLines));
  const lines = (row: number, cell: number) => lineCache[row]?.[cell] ?? [];
  const widths = estimateColumnWidths(layout, lines, sizing);
  const heights = estimateRowHeights(layout, lines, widths, sizing);
  const tableWidth = sumPx(widths);

  const wrapper = doc.createElement("div");
  wrapper.className = TABLE_CHUNKED_CLASS;

  for (const chunk of planTableChunks(layout, chunkRows)) {
    const box = doc.createElement("div");
    box.className = TABLE_CHUNK_CLASS;
    box.style.width = `${tableWidth}px`;
    box.style.setProperty(
      "contain-intrinsic-size",
      `auto ${tableWidth}px auto ${sumPx(heights.slice(chunk.start, chunk.end))}px`,
    );

    // 표의 속성(id 등)은 첫 묶음에만 — 같은 id 가 여러 번 나오면 안 된다
    const chunkTable =
      chunk.start === 0
        ? (table.cloneNode(false) as HTMLTableElement)
        : doc.createElement("table");
    if (chunk.start !== 0 && table.className) {
      chunkTable.className = table.className;
    }
    chunkTable.style.width = `${tableWidth}px`;
    chunkTable.append(buildColgroup(doc, widths));

    const body = doc.createElement("tbody");
    for (const planned of chunk.rows) {
      const tr = rows[planned.rowIndex];
      if (!tr) continue;
      const rowCells = cells[planned.rowIndex] ?? [];
      tr.replaceChildren(
        ...planned.cells.map((cell) => placeCell(doc, cell, rowCells, cells)),
      );
      body.append(tr);
    }
    chunkTable.append(body);
    box.append(chunkTable);
    wrapper.append(box);
  }
  return wrapper;
}

function buildColgroup(
  doc: Document,
  widths: ReadonlyArray<number>,
): HTMLTableColElement {
  const colgroup = doc.createElement("colgroup");
  for (const width of widths) {
    const col = doc.createElement("col");
    col.style.width = `${width}px`;
    colgroup.append(col);
  }
  return colgroup;
}

/** 계획한 칸 하나를 실제 셀 요소로 — 원래 셀은 옮기고, 이어지는 칸만 만든다 */
function placeCell(
  doc: Document,
  planned: PlannedCell,
  rowCells: ReadonlyArray<HTMLTableCellElement>,
  allCells: ReadonlyArray<ReadonlyArray<HTMLTableCellElement>>,
): HTMLTableCellElement {
  if (planned.kind === "filler") {
    const filler = doc.createElement("td");
    if (planned.colSpan > 1) filler.colSpan = planned.colSpan;
    filler.setAttribute("aria-hidden", "true");
    return filler;
  }
  if (planned.kind === "own") {
    const cell = rowCells[planned.cellIndex] ?? doc.createElement("td");
    if (cell.rowSpan !== planned.rowSpan) cell.rowSpan = planned.rowSpan;
    cell.classList.toggle(SPAN_OPEN_CLASS, planned.continuesBelow);
    return cell;
  }

  // 원래 셀의 클래스(숨김 표시 등)를 이어받아야 병합 자리가 같은 모양으로 이어진다
  const source = allCells[planned.sourceRow]?.[planned.sourceCell];
  const cell = doc.createElement(source?.tagName === "TH" ? "th" : "td");
  if (source?.className) cell.className = source.className;
  cell.classList.add(SPAN_CONTINUATION_CLASS);
  cell.classList.toggle(SPAN_OPEN_CLASS, planned.continuesBelow);
  if (planned.colSpan > 1) cell.colSpan = planned.colSpan;
  if (planned.rowSpan > 1) cell.rowSpan = planned.rowSpan;
  cell.setAttribute("aria-hidden", "true");
  return cell;
}
