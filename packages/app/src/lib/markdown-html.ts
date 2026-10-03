import type { Element, ElementContent, Root, RootContent } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
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
 * 결과 미리보기의 Markdown → 정화된 HTML.
 *
 * Web Worker 에서 돌리려고 DOM 을 쓰지 않는다 (`markdown-html.worker.ts`).
 * 예전에는 react-markdown 이 렌더마다 메인 스레드에서 같은 일을 했는데, 실물
 * 엑셀 결과(2.7MB, 표 5,900행)에서 파싱만 1.4초였고 검색창에 한 글자 칠
 * 때마다 다시 돌았다.
 *
 * 정화 규칙은 react-markdown 시절과 같다: GFM + 원본 HTML 허용(rehype-raw) 후
 * GitHub 기본 스키마로 정화. 큰 표는 정화 **뒤에** 행 묶음으로 나눈다 — 묶음에
 * 붙이는 class·style 은 우리가 만든 값이라 정화 대상이 아니고, 정화 전에 붙이면
 * 지워진다. 묶음 구조는 `dom-table-chunks`(원본 뷰어)와 같다.
 */

/**
 * GitHub 기본 sanitize 스키마에 우리 변환 결과가 사용하는 인라인 HTML을
 * 추가 허용한다.
 * - `br`: 표 셀 안 줄바꿈 (HWPX 중첩 표 평탄화에서 사용)
 * - `td/th`의 `colspan`/`rowspan`: 부모 표 병합 셀 보존
 */
export const PREVIEW_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "br"],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    td: [...(defaultSchema.attributes?.td ?? []), "colspan", "rowspan"],
    th: [...(defaultSchema.attributes?.th ?? []), "colspan", "rowspan"],
  },
};

/**
 * 미리보기 표의 열 폭·높이 어림 기준. styles.css 의 `.markdown-body` 표 규칙
 * (14px, 줄 높이 1.65, 셀 여백 7px 12px, 아래 테두리 1px)과 맞춘다.
 */
const PREVIEW_TABLE_SIZING: TableSizingOptions = {
  fontPx: 14,
  horizontalPaddingPx: 24,
  verticalPaddingPx: 15,
  lineHeightPx: 23,
  minColumnPx: 48,
  maxColumnPx: 360,
};

const CHUNKED_CLASS = "table-chunked";
const CHUNK_CLASS = "table-chunk";
const SPAN_OPEN_CLASS = "table-span-open";
const SPAN_CONTINUATION_CLASS = "table-span-cont";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, PREVIEW_SANITIZE_SCHEMA)
  .use(() => (tree: Root) => chunkLargeTables(tree))
  .use(rehypeStringify);

export function renderMarkdownToHtml(markdown: string): string {
  return String(processor.processSync(markdown));
}

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === "element";
}

/** 트리 전체에서 큰 표를 묶음으로 바꾼다. 표 안의 표는 바깥 표와 함께 둔다 */
function chunkLargeTables(tree: Root): Root {
  return { ...tree, children: tree.children.map(transformNode) };
}

/** 바뀐 곳이 없으면 원래 노드를 그대로 돌려준다 — 표가 없는 문서는 복사 0 */
function transformNode<T extends RootContent | ElementContent>(node: T): T {
  if (!isElement(node)) return node;
  if (node.tagName === "table") return (chunkTable(node) ?? node) as T;
  const children = node.children.map(transformNode);
  const changed = children.some((child, i) => child !== node.children[i]);
  return changed ? ({ ...node, children } as T) : node;
}

interface TableRows {
  readonly header: ReadonlyArray<Element>;
  readonly body: ReadonlyArray<Element>;
}

/**
 * 머리 1구역 + 본문 1구역짜리 단순한 표의 행. GFM 표는 늘 이 모양이다.
 * tfoot·열 정의·여러 본문 구역이 있는 원본 HTML 표는 나누면 의미가 바뀌므로
 * (브라우저는 rowspan 을 행 구역 경계에서 자르고 tfoot 을 맨 아래에 그린다)
 * null 을 돌려 그대로 둔다. 표 바로 아래 글자도 마찬가지다 — 정화가 `<caption>`
 * 같은 허용 밖 태그를 벗기면 글자만 표 안에 남는데, 나누면 그 글자가 사라진다.
 */
function rowsOf(table: Element): TableRows | null {
  const hasLooseText = table.children.some(
    (child) => child.type === "text" && child.value.trim() !== "",
  );
  if (hasLooseText) return null;
  const sections = table.children.filter(isElement);
  const heads = sections.filter((child) => child.tagName === "thead");
  const bodies = sections.filter((child) => child.tagName === "tbody");
  const isPlain =
    heads.length <= 1 &&
    bodies.length <= 1 &&
    sections.every(
      (child) => child.tagName === "thead" || child.tagName === "tbody",
    );
  if (!isPlain) return null;
  return {
    header: heads[0] ? rowElements(heads[0]) : [],
    body: bodies[0] ? rowElements(bodies[0]) : [],
  };
}

function rowElements(section: Element): Array<Element> {
  return section.children.filter(
    (child): child is Element => isElement(child) && child.tagName === "tr",
  );
}

function cellsOf(row: Element): Array<Element> {
  return row.children.filter(
    (child): child is Element =>
      isElement(child) && (child.tagName === "td" || child.tagName === "th"),
  );
}

/** span 속성 값. 상한·`rowspan="0"` 해석은 `layoutTable` 이 한다 */
function spanOf(cell: Element, key: "colSpan" | "rowSpan"): number {
  const value = Number(cell.properties?.[key] ?? 1);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/** `<br>` 을 줄 경계로 보고 셀 텍스트를 줄로 나눈다 */
function cellLines(cell: Element): ReadonlyArray<string> {
  const lines: Array<string> = [""];
  const walk = (node: Element): void => {
    for (const child of node.children) {
      if (child.type === "text") {
        lines[lines.length - 1] += child.value;
      } else if (isElement(child)) {
        if (child.tagName === "br") lines.push("");
        else walk(child);
      }
    }
  };
  walk(cell);
  return lines;
}

function classesOf(cell: Element | undefined): Array<string> {
  const current = cell?.properties?.className;
  return Array.isArray(current) ? current.map(String) : [];
}

function element(
  tagName: string,
  properties: Element["properties"],
  children: Array<ElementContent>,
): Element {
  return { type: "element", tagName, properties, children };
}

function chunkTable(table: Element): Element | null {
  const rows = rowsOf(table);
  if (!rows || rows.body.length <= TABLE_CHUNK_MIN_ROWS) return null;
  const { header, body } = rows;

  const headerCells = header.map(cellsOf);
  const bodyCells = body.map(cellsOf);
  const spans = (rows: ReadonlyArray<ReadonlyArray<Element>>) =>
    rows.map((row) =>
      row.map((cell) => ({
        colSpan: spanOf(cell, "colSpan"),
        rowSpan: spanOf(cell, "rowSpan"),
      })),
    );

  // 머리·본문은 브라우저처럼 따로 배치하고(머리의 rowspan 은 본문으로 넘어가지
  // 않는다), 열 폭은 둘 중 넓은 쪽으로 정한다
  const headerLayout = layoutTable(spans(headerCells));
  const bodyLayout = layoutTable(spans(bodyCells));
  const columnCount = Math.max(
    headerLayout.columnCount,
    bodyLayout.columnCount,
  );
  if (columnCount > TABLE_CHUNK_MAX_COLUMNS) return null;

  const headerLines = headerCells.map((row) => row.map(cellLines));
  const bodyLines = bodyCells.map((row) => row.map(cellLines));
  const headerWidths = estimateColumnWidths(
    headerLayout,
    (row, cell) => headerLines[row]?.[cell] ?? [],
    PREVIEW_TABLE_SIZING,
  );
  const bodyWidths = estimateColumnWidths(
    bodyLayout,
    (row, cell) => bodyLines[row]?.[cell] ?? [],
    PREVIEW_TABLE_SIZING,
  );
  const widths = Array.from({ length: columnCount }, (_, col) =>
    Math.max(
      headerWidths[col] ?? PREVIEW_TABLE_SIZING.minColumnPx,
      bodyWidths[col] ?? PREVIEW_TABLE_SIZING.minColumnPx,
    ),
  );
  const heights = estimateRowHeights(
    bodyLayout,
    (row, cell) => bodyLines[row]?.[cell] ?? [],
    widths,
    PREVIEW_TABLE_SIZING,
  );
  const tableWidth = sumPx(widths);
  const colgroup = element(
    "colgroup",
    {},
    widths.map((width) => element("col", { style: `width:${width}px` }, [])),
  );
  const thead = element(
    "thead",
    {},
    header.map((row, index) => ({
      ...row,
      children: headerCells[index] ?? [],
    })),
  );

  const chunks = planTableChunks(bodyLayout, TABLE_CHUNK_ROWS).map(
    (chunk, index): Element => {
      const rows = chunk.rows.map((planned): Element => {
        const tr = body[planned.rowIndex] as Element;
        const cells = bodyCells[planned.rowIndex] ?? [];
        return {
          ...tr,
          children: planned.cells.map((cell) =>
            placeCell(cell, cells, bodyCells),
          ),
        };
      });
      const sections =
        index === 0 && header.length > 0
          ? [thead, element("tbody", {}, rows)]
          : [element("tbody", {}, rows)];
      const chunkHeight = sumPx(heights.slice(chunk.start, chunk.end));
      return element(
        "div",
        {
          className: [CHUNK_CLASS],
          style: `width:${tableWidth}px;contain-intrinsic-size:auto ${tableWidth}px auto ${chunkHeight}px`,
        },
        [
          element(
            "table",
            // 표의 속성(id 등)은 첫 묶음에만 — 같은 id 가 여러 번 나오면 안 된다
            index === 0
              ? { ...table.properties, style: `width:${tableWidth}px` }
              : { style: `width:${tableWidth}px` },
            [colgroup, ...sections],
          ),
        ],
      );
    },
  );

  return element("div", { className: [CHUNKED_CLASS] }, chunks);
}

/** 계획한 칸 하나를 hast 셀로 — 원래 셀을 재사용하고, 이어지는 칸만 만든다 */
function placeCell(
  planned: PlannedCell,
  rowCells: ReadonlyArray<Element>,
  allCells: ReadonlyArray<ReadonlyArray<Element>>,
): Element {
  if (planned.kind === "filler") {
    const properties: Element["properties"] = { ariaHidden: "true" };
    if (planned.colSpan > 1) properties.colSpan = planned.colSpan;
    return element("td", properties, []);
  }
  if (planned.kind === "own") {
    const cell = rowCells[planned.cellIndex] ?? element("td", {}, []);
    if (
      spanOf(cell, "rowSpan") === planned.rowSpan &&
      !planned.continuesBelow
    ) {
      return cell;
    }
    return {
      ...cell,
      properties: {
        ...cell.properties,
        rowSpan: planned.rowSpan,
        ...(planned.continuesBelow
          ? { className: [...classesOf(cell), SPAN_OPEN_CLASS] }
          : {}),
      },
    };
  }

  // 원래 셀의 클래스를 이어받아야 병합 자리가 같은 모양으로 이어진다
  const source = allCells[planned.sourceRow]?.[planned.sourceCell];
  const properties: Element["properties"] = {
    className: [
      ...classesOf(source),
      SPAN_CONTINUATION_CLASS,
      ...(planned.continuesBelow ? [SPAN_OPEN_CLASS] : []),
    ],
    ariaHidden: "true",
  };
  if (planned.colSpan > 1) properties.colSpan = planned.colSpan;
  if (planned.rowSpan > 1) properties.rowSpan = planned.rowSpan;
  return element(source?.tagName === "th" ? "th" : "td", properties, []);
}
