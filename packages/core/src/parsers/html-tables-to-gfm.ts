import { parseHTML } from "linkedom";
import { htmlToMarkdown } from "../html-to-md.js";

/**
 * kordoc이 내보내는 HTML 표를 자체 HWPX 파서와 같은 계약의 GFM으로 내린다.
 *
 * kordoc은 colspan/rowspan을 원형 보존한 HTML `<table>`을 Markdown 안에 섞어
 * 낸다. 충실하지만 태그 오버헤드가 커서(실측 4표본 토큰 +4.9~+56.8%) 제품의
 * 1급 목표인 AI 입력 토큰 절감과 충돌한다.
 *
 * 셀 내용은 **HTML 그대로 유지한 채** 재조립해 `htmlToMarkdown`(turndown +
 * gfm 플러그인)에 넘긴다. 텍스트만 뽑아내면 셀 안 이미지가 사라진다
 * (2026-04-13에 고쳤던 "표 셀 내부 이미지 누락" 버그의 재발). 자체 HWPX
 * 파서도 같은 함수로 내려가므로 두 경로의 출력 계약이 자동으로 맞는다.
 */

/** 무한 재귀 차단 — hwpx-parser와 같은 값 */
const MAX_NEST_DEPTH = 5;
const NESTED_CELL_SEP = " · ";
const NESTED_ROW_SEP = "<br>";

/**
 * 병합 자리 표기. 화살표는 **내용이 있는 원점 방향**을 가리킨다("저기를 보라").
 *
 * GFM 표에는 셀 병합 문법이 없다. 빈 셀로 padding하면 "진짜 빈칸"과 "병합
 * 자리"가 구분되지 않는데, 실물 표본에서 빈칸처럼 보이는 셀의 59%가 사실
 * 병합 자리였다. 빈 GFM 셀도 padding 공백으로 이미 토큰 1개를 쓰므로 이
 * 표기의 토큰 비용은 0이다 (2026-08-08 실측, 4표본 전부 ±0).
 */
export const MERGE_LEFT = "←";
export const MERGE_UP = "↑";

/**
 * 셀 안의 "|"를 잠시 대신할 문자 (PUA U+E000).
 *
 * 셀 텍스트의 "|"는 부모 GFM 표의 컬럼 구분자와 충돌해 표를 깬다. 그런데
 * HTML 단계에서 미리 "\|"로 escape하면 turndown이 백슬래시를 한 번 더 escape해
 * "\\|"가 되어 여전히 깨진다(2026-08-08 실측). 그래서 turndown을 통과시킨 뒤
 * 마지막에 "\|"로 되돌린다. 한컴 PUA는 U+F0xx 대역이라 겹치지 않는다.
 */
const PIPE_TOKEN = "";

/** 태그 바깥의 "|"만 자리표시자로 바꾼다 (img src 등 속성값은 건드리지 않음) */
function protectPipes(html: string): string {
  return html.replace(/<[^>]+>|\|/g, (m) => (m === "|" ? PIPE_TOKEN : m));
}

function restorePipes(markdown: string): string {
  return markdown.split(PIPE_TOKEN).join("\\|");
}

interface CellLike {
  readonly html: string;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/**
 * core tsconfig에는 DOM lib이 없어 `Element`를 직접 못 쓴다 (html-to-md.ts와
 * 같은 사정). linkedom이 실제로 제공하는 것 중 여기서 쓰는 것만 좁혀 둔다.
 */
interface ElementLike {
  readonly children: ArrayLike<ElementLike>;
  readonly innerHTML: string;
  matches(selector: string): boolean;
  cloneNode(deep: boolean): ElementLike;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  getAttribute(name: string): string | null;
  remove(): void;
}

function directChildren(el: ElementLike, selector: string): Array<ElementLike> {
  return Array.from(el.children).filter((child) => child.matches(selector));
}

/** thead/tbody 래퍼를 건너뛰고 이 표의 직속 행만 모은다 */
function ownRows(table: ElementLike): Array<ElementLike> {
  const rows = directChildren(table, "tr");
  if (rows.length > 0) return rows;
  return directChildren(table, "thead, tbody, tfoot").flatMap((section) =>
    directChildren(section, "tr"),
  );
}

const ownCells = (row: ElementLike): Array<ElementLike> =>
  directChildren(row, "td, th");

/** 자식 표를 제외한 셀 내부 HTML (이미지·<br>·강조는 그대로 살린다) */
function ownHtml(cell: ElementLike): string {
  const clone = cell.cloneNode(true);
  for (const nested of Array.from(clone.querySelectorAll("table"))) {
    nested.remove();
  }
  return (clone.innerHTML ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 셀 안의 중첩 표를 `(표 R×C)<br>행1셀1 · 행1셀2<br>…` 로 평탄화한다.
 *
 * GFM 표 셀은 블록 요소를 담지 못해, 중첩 표를 그대로 두면 부모 표가 통째로
 * 깨진다 (2026-05-13 결정). 대괄호 대신 소괄호를 쓰는 이유는 turndown이
 * `[...]`를 링크 문법으로 escape하기 때문이다.
 */
function flattenNestedTable(table: ElementLike, depth: number): string {
  const rows = ownRows(table);
  const firstRow = rows[0];
  const meta = `(표 ${rows.length}×${firstRow ? ownCells(firstRow).length : 0})`;

  if (depth >= MAX_NEST_DEPTH) return `${meta} 깊이 초과 생략`;

  const rowTexts = rows.map((row) =>
    ownCells(row)
      .map((cell) => cellHtml(cell, depth + 1))
      .join(NESTED_CELL_SEP),
  );
  return `${meta}${NESTED_ROW_SEP}${rowTexts.join(NESTED_ROW_SEP)}`;
}

/** 셀 하나의 최종 HTML — 본문 + 직속 중첩 표를 평탄화한 결과 */
function cellHtml(cell: ElementLike, depth: number): string {
  const parts: Array<string> = [];
  const own = ownHtml(cell);
  if (own) parts.push(own);
  for (const nested of directChildren(cell, "table")) {
    parts.push(flattenNestedTable(nested, depth));
  }
  return parts.join(NESTED_ROW_SEP);
}

/**
 * colspan/rowspan을 풀어 직사각 grid를 만든다. 병합 연속 자리에는 원점 방향
 * 화살표를 남긴다.
 *
 * GFM 표는 첫 행 separator로 열 수가 결정되어 뒤 행의 셀 수가 다르면 잘린다.
 * 그래서 모든 행을 max(grid) 크기로 맞춘다 (2026-05-13 결정).
 */
function expandToGrid(table: ElementLike): Array<Array<string>> {
  const grid: Array<Array<string>> = [];
  /** col 위치 → 남은 rowspan 행 수 */
  const reserved = new Map<number, number>();

  for (const row of ownRows(table)) {
    const cells: Array<CellLike> = ownCells(row).map((cell) => ({
      html: cellHtml(cell, 0),
      colSpan: Math.max(1, Number(cell.getAttribute("colspan")) || 1),
      rowSpan: Math.max(1, Number(cell.getAttribute("rowspan")) || 1),
    }));

    const out: Array<string> = [];
    let col = 0;
    let idx = 0;

    const drainReserved = (): void => {
      let left = reserved.get(col) ?? 0;
      while (left > 0) {
        out[col] = MERGE_UP;
        if (left - 1 <= 0) reserved.delete(col);
        else reserved.set(col, left - 1);
        col += 1;
        left = reserved.get(col) ?? 0;
      }
    };

    while (idx < cells.length || (reserved.get(col) ?? 0) > 0) {
      drainReserved();
      const cell = cells[idx];
      if (!cell) break;
      idx += 1;

      const start = col;
      out[col] = cell.html;
      col += 1;
      for (let i = 1; i < cell.colSpan; i += 1) {
        out[col] = MERGE_LEFT;
        col += 1;
      }
      if (cell.rowSpan > 1) {
        for (let c = start; c < col; c += 1) reserved.set(c, cell.rowSpan - 1);
      }
    }

    grid.push(out);
  }

  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of grid) {
    for (let i = 0; i < width; i += 1) {
      if (row[i] === undefined) row[i] = "";
    }
  }
  return grid;
}

/** grid를 span 없는 평평한 HTML 표로 되돌린다 (turndown이 GFM으로 내린다) */
function gridToHtml(grid: ReadonlyArray<ReadonlyArray<string>>): string {
  const rows = grid.map((row, ri) => {
    const tag = ri === 0 ? "th" : "td";
    return `<tr>${row.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  });
  return `<table>${rows.join("")}</table>`;
}

/** 중첩을 고려해 최상위 `<table>` 블록의 시작/끝 위치를 찾는다 */
function findTopLevelTables(md: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const token = /<\/?table\b[^>]*>/gi;
  let depth = 0;
  let start = -1;
  let match = token.exec(md);

  while (match !== null) {
    if (match[0].startsWith("</")) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: match.index + match[0].length });
        start = -1;
      }
    } else {
      if (depth === 0) start = match.index;
      depth += 1;
    }
    match = token.exec(md);
  }
  return spans;
}

/** Markdown 안의 HTML 표를 GFM 표로 바꾼다. 표 바깥 내용은 건드리지 않는다. */
export function normalizeHtmlTablesToGfm(markdown: string): string {
  const spans = findTopLevelTables(markdown);
  if (spans.length === 0) return markdown;

  const pieces: Array<string> = [];
  let cursor = 0;

  for (const { start, end } of spans) {
    pieces.push(markdown.slice(cursor, start));
    const html = markdown.slice(start, end);
    const { document } = parseHTML(`<body>${protectPipes(html)}</body>`);
    const table = document.querySelector("table");
    const grid = table ? expandToGrid(table) : [];
    pieces.push(
      grid.length === 0
        ? html
        : restorePipes(htmlToMarkdown(gridToHtml(grid)).trim()),
    );
    cursor = end;
  }

  pieces.push(markdown.slice(cursor));
  return pieces.join("");
}
