import { htmlToMarkdownKeepingTables } from "../../html-to-md.js";
import type { HiddenExclusion } from "../../types.js";
import { normalizeHtmlTablesToGfm } from "../html-tables-to-gfm.js";
import type { CellSpan, SheetGrid } from "./grid.js";
import type { VisibleGrid } from "./visibility.js";
import { projectVisibleGrid } from "./visibility.js";

/**
 * 스프레드시트 격자 → HTML/Markdown 공용 렌더.
 *
 * XLSX와 XLS는 파일을 여는 방법만 다르고, 여기서부터는 완전히 같은 코드를 탄다.
 * 확장자가 다르다는 이유로 같은 표가 다르게 나오면 사용자는 버그로 받아들인다.
 *
 * 표는 colspan/rowspan을 살린 HTML로 만든 뒤 `normalizeHtmlTablesToGfm`에
 * 넘긴다. HWPX·DOCX와 같은 함수를 타므로 병합 화살표·grid 정규화 계약이
 * 자동으로 일치한다.
 */

/** 시트 하나에서 읽을 최대 행·열. 초과분은 잘라내고 반드시 경고를 남긴다. */
export const MAX_ROWS_PER_SHEET = 5000;
export const MAX_COLS_PER_SHEET = 200;

/**
 * 원본에서 숨김이던 자리에 붙는 클래스. 뷰어가 흐리게 표시해 "감춰져 있던
 * 칸"임을 알린다. Markdown 변환에는 영향이 없다 (turndown이 클래스를 버린다).
 */
const HIDDEN_ROW_CLASS = "xlsx-hidden-row";
const HIDDEN_COL_CLASS = "xlsx-hidden-col";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 병합 크기를 colspan/rowspan 속성 문자열로 (1칸이면 빈 문자열) */
function spanAttributes(span: CellSpan | undefined): string {
  if (!span) return "";
  const attrs: Array<string> = [];
  if (span.colSpan > 1) attrs.push(`colspan="${span.colSpan}"`);
  if (span.rowSpan > 1) attrs.push(`rowspan="${span.rowSpan}"`);
  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

/** 셀 하나를 <td>/<th>로 만든다 */
function renderCell(
  text: string,
  span: CellSpan | undefined,
  href: string | undefined,
  isHeader: boolean,
  isHiddenCol: boolean,
): string {
  // 셀 안 줄바꿈(Alt+Enter)은 \n으로 저장된다. HTML에서 \n은 공백으로 접히므로
  // <br>로 바꿔야 원본의 줄 구분이 살아남는다.
  const escaped = escapeHtml(text).replace(/\r?\n/g, "<br>");
  const content = href
    ? `<a href="${escapeHtml(href)}">${escaped || escapeHtml(href)}</a>`
    : escaped;
  const tag = isHeader ? "th" : "td";
  const cls = isHiddenCol ? ` class="${HIDDEN_COL_CLASS}"` : "";
  return `<${tag}${spanAttributes(span)}${cls}>${content}</${tag}>`;
}

/** 격자(숨김 반영 완료)를 HTML 표로 만든다 */
function gridToHtmlTable(
  grid: VisibleGrid,
  hyperlinkTargets: ReadonlyMap<string, string>,
  limits: { rows: number; cols: number },
): string {
  const rows: Array<string> = [];

  for (let r = 0; r < limits.rows; r += 1) {
    const cells: Array<string> = [];

    for (let c = 0; c < limits.cols; c += 1) {
      const position = `${r},${c}`;
      if (grid.covered.has(position)) continue;
      cells.push(
        renderCell(
          grid.cells[r]?.[c] ?? "",
          grid.spans.get(position),
          hyperlinkTargets.get(position),
          r === 0,
          grid.hiddenCols.has(c),
        ),
      );
    }

    if (cells.length === 0) continue;
    const rowClass = grid.hiddenRows.has(r)
      ? ` class="${HIDDEN_ROW_CLASS}"`
      : "";
    rows.push(`<tr${rowClass}>${cells.join("")}</tr>`);
  }

  return rows.length > 0 ? `<table>${rows.join("")}</table>` : "";
}

/**
 * 숨김 제외로 실제로 빠진 것이 있으면 무엇이 빠졌는지 알린다.
 *
 * "어떻게 포함하는지"는 여기서 말하지 않는다 — core는 자기가 CLI에서 쓰이는지
 * GUI에서 쓰이는지 모른다. 되돌리는 방법 안내는 각 진입점의 몫이다.
 */
function hiddenExclusionWarning(
  sheetName: string,
  hiddenRows: number,
  hiddenCols: number,
): string | null {
  if (hiddenRows === 0 && hiddenCols === 0) return null;
  const parts: Array<string> = [];
  if (hiddenRows > 0) parts.push(`행 ${hiddenRows}개`);
  if (hiddenCols > 0) parts.push(`열 ${hiddenCols}개`);
  return `시트 "${sheetName}"의 숨겨진 ${parts.join("·")}를 제외했습니다.`;
}

export interface RenderableSheet {
  readonly name: string;
  readonly grid: SheetGrid;
  /**
   * 셀 위치 → 실제 링크 주소. 포맷마다 푸는 방법이 달라(XLSX는 관계 파일,
   * XLS는 레코드 내부) 이미 푼 결과를 받는다.
   */
  readonly hyperlinkTargets?: ReadonlyMap<string, string>;
  /** 표 뒤에 붙일 추가 HTML (이미지 등) */
  readonly extraHtml?: ReadonlyArray<string>;
}

export interface WorkbookRenderOptions {
  readonly includeHidden: boolean;
  /** 숨김이라 렌더 대상에서 뺀 시트 이름 */
  readonly hiddenSheetNames: ReadonlyArray<string>;
}

export interface WorkbookRender {
  readonly html: string;
  readonly markdown: string;
  readonly warnings: Array<string>;
  readonly hiddenExcluded?: HiddenExclusion;
}

/** 시트 하나를 HTML로 (숨김 반영 + 상한 적용) */
function renderSheet(
  sheet: RenderableSheet,
  includeHidden: boolean,
  excluded: HiddenExclusion,
  warnings: Array<string>,
): string {
  if (!includeHidden) {
    excluded.rows += sheet.grid.hiddenRows.size;
    excluded.cols += sheet.grid.hiddenCols.size;
    const warning = hiddenExclusionWarning(
      sheet.name,
      sheet.grid.hiddenRows.size,
      sheet.grid.hiddenCols.size,
    );
    if (warning) warnings.push(warning);
  }

  const visible = projectVisibleGrid(sheet.grid, includeHidden);
  const totalRows = visible.cells.length;
  const totalCols = visible.cells[0]?.length ?? 0;
  const rows = Math.min(totalRows, MAX_ROWS_PER_SHEET);
  const cols = Math.min(totalCols, MAX_COLS_PER_SHEET);
  if (rows < totalRows || cols < totalCols) {
    warnings.push(
      `시트 "${sheet.name}"가 너무 커서 ${rows}행 × ${cols}열까지만 변환했습니다 ` +
        `(원본 ${totalRows}행 × ${totalCols}열).`,
    );
  }

  const parts = [`<h2>${escapeHtml(sheet.name)}</h2>`];
  const table = gridToHtmlTable(
    visible,
    sheet.hyperlinkTargets ?? visible.hyperlinkRels,
    { rows, cols },
  );
  if (table) parts.push(table);
  parts.push(...(sheet.extraHtml ?? []));
  return parts.join("\n");
}

/** 통합 문서 전체를 HTML·Markdown으로 렌더한다 */
export function renderWorkbook(
  sheets: ReadonlyArray<RenderableSheet>,
  options: WorkbookRenderOptions,
): WorkbookRender {
  const warnings: Array<string> = [];
  const excluded: HiddenExclusion = { sheets: 0, rows: 0, cols: 0 };

  if (options.hiddenSheetNames.length > 0 && !options.includeHidden) {
    excluded.sheets = options.hiddenSheetNames.length;
    warnings.push(
      `숨겨진 시트 ${options.hiddenSheetNames.length}개를 제외했습니다: ${options.hiddenSheetNames.join(", ")}`,
    );
  }

  const htmlParts = sheets
    .map((sheet) =>
      renderSheet(sheet, options.includeHidden, excluded, warnings),
    )
    .filter((part) => part !== "");

  const html = htmlParts.join("\n");
  const markdown = normalizeHtmlTablesToGfm(htmlToMarkdownKeepingTables(html));

  return {
    html,
    markdown,
    warnings,
    ...(excluded.sheets + excluded.rows + excluded.cols > 0
      ? { hiddenExcluded: excluded }
      : {}),
  };
}
