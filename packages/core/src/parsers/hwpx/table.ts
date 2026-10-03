import { rawMarkdownHtml } from "../../html-to-md.js";
import { MERGE_LEFT, MERGE_UP } from "../html-tables-to-gfm.js";
import {
  type HwpxContext,
  MAX_OBJECT_DEPTH,
  type WalkMode,
} from "./context.js";
import { tableCaption } from "./controls.js";
import { resolveParagraphMarker } from "./numbering.js";
import { walkParagraph } from "./walker.js";
import { attr, childNode, childNodes, type XmlNode } from "./xml.js";

// GFM 테이블 셀은 블록 요소(중첩 표/리스트)를 못 담으므로, 셀 안의 표는
// 인라인 텍스트로 평탄화한다. 원본 구조 추적을 위해 (표 R×C) 메타 prefix를
// 붙이고, 행 사이는 <br>(GFM 셀 안 줄바꿈), 셀 사이는 " · "로 구분한다.
// - 대괄호 대신 (...)를 쓰는 이유: turndown이 [...]를 markdown 링크 syntax로
//   인식해 `\[...\]`로 escape해 출력 가독성이 떨어진다.
// - 셀 사이를 "|"가 아닌 "·"로 쓰는 이유: 부모 GFM 표 안에 끼워질 때 "|"가
//   부모 컬럼 구분자로 잘못 해석되어 부모 표 구조가 깨진다.
// - <br>은 html-to-md의 brInTableCell 규칙으로 셀 안에서 그대로 유지된다.
// 무한 재귀는 MAX_NEST_DEPTH로 차단.
const MAX_NEST_DEPTH = 5;
const NESTED_CELL_SEP = " · ";
const NESTED_ROW_SEP = "<br>";

/** 표 셀 안 — "|" 보호, 그림은 글자 흐름 안에 */
function cellMode(depth: number): WalkMode {
  return { inCell: true, inHeading: false, imagesInline: true, depth };
}

interface CellPart {
  readonly kind: "text" | "nested-table";
  readonly value: string;
}

/** 문단 머리(번호·기호)를 앞에 붙인다 — escape되지 않도록 전용 요소로 감싼다 */
export function withMarker(marker: string | null, html: string): string {
  return marker ? `${rawMarkdownHtml(marker)} ${html}` : html;
}

function paragraphMarker(paragraph: XmlNode, ctx: HwpxContext): string | null {
  return (
    resolveParagraphMarker(
      attr(paragraph, "paraPrIDRef"),
      ctx.header,
      ctx.numbering,
      ctx.state.outlineNumberingId,
    )?.text ?? null
  );
}

/**
 * 셀 안 문단 하나를 셀 조각들로 나눈다. 글자는 문서 순서대로 text 조각이 되고,
 * 중첩 표는 평탄화된 nested-table 조각, 글상자 문단은 같은 규칙으로 재귀한다.
 */
function paragraphParts(
  paragraph: XmlNode,
  ctx: HwpxContext,
  mode: WalkMode,
  depth: number,
): Array<CellPart> {
  let marker = paragraphMarker(paragraph, ctx);
  const parts: Array<CellPart> = [];
  for (const segment of walkParagraph(paragraph, ctx, mode)) {
    if (segment.kind === "inline" || segment.kind === "image") {
      parts.push({ kind: "text", value: withMarker(marker, segment.html) });
      marker = null;
    } else if (segment.kind === "table") {
      parts.push(...nestedTableParts(segment.node, ctx, mode, depth));
    } else if (mode.depth < MAX_OBJECT_DEPTH) {
      const inner = { ...mode, depth: mode.depth + 1 };
      for (const p of segment.paragraphs) {
        parts.push(...paragraphParts(p, ctx, inner, depth));
      }
    }
  }
  return parts;
}

function paragraphsParts(
  paragraphs: ReadonlyArray<XmlNode>,
  ctx: HwpxContext,
  mode: WalkMode,
  depth: number,
): Array<CellPart> {
  return paragraphs.flatMap((p) => paragraphParts(p, ctx, mode, depth));
}

/** 중첩 표 + 캡션(표 앞/뒤 글자 조각) */
function nestedTableParts(
  tbl: XmlNode,
  ctx: HwpxContext,
  mode: WalkMode,
  depth: number,
): Array<CellPart> {
  const caption = tableCaption(tbl);
  const captionParts = caption
    ? paragraphsParts(caption.paragraphs, ctx, mode, depth)
    : [];
  const flat = flattenTableToText(tbl, ctx, mode, depth);
  const table: Array<CellPart> = flat
    ? [{ kind: "nested-table", value: flat }]
    : [];
  return caption?.before
    ? [...captionParts, ...table]
    : [...table, ...captionParts];
}

function flattenTableToText(
  tbl: XmlNode,
  ctx: HwpxContext,
  mode: WalkMode,
  depth: number,
): string {
  const rows = childNodes(tbl, "tr");
  const firstRow = rows[0];
  if (!firstRow) return "";

  const colCount = childNodes(firstRow, "tc").length;
  const meta = `(표 ${rows.length}×${colCount})`;
  if (depth >= MAX_NEST_DEPTH) return `${meta} 깊이 초과 생략`;

  const rowTexts = rows.map((row) =>
    childNodes(row, "tc")
      .map((tc) => cellHtml(tc, ctx, mode, depth + 1).trim())
      .join(NESTED_CELL_SEP),
  );
  return `${meta}${NESTED_ROW_SEP}${rowTexts.join(NESTED_ROW_SEP)}`;
}

/**
 * 셀 출력 부분들을 결합한다. 중첩 표 항목은 앞뒤에 <br>을 두어 텍스트와
 * 시각적으로 분리하고, 일반 텍스트끼리는 2개 이하면 공백, 3개 이상이면
 * " / "로 묶는다 (셀 안 하드 브레이크는 GFM 1행 1줄 계약을 깨므로 의도된
 * 평탄화다). 텍스트와 중첩 표가 섞이면 등장 순서를 보존한다.
 */
function joinCellParts(parts: ReadonlyArray<CellPart>): string {
  const segments: Array<string> = [];
  let buffer: Array<string> = [];
  const flushBuffer = (): void => {
    if (buffer.length === 0) return;
    segments.push(buffer.join(buffer.length <= 2 ? " " : " / "));
    buffer = [];
  };
  for (const part of parts) {
    if (part.kind === "text") {
      buffer.push(part.value);
    } else {
      flushBuffer();
      segments.push(part.value);
    }
  }
  flushBuffer();
  return segments.join(NESTED_ROW_SEP);
}

function cellHtml(
  tc: XmlNode,
  ctx: HwpxContext,
  mode: WalkMode,
  depth: number,
): string {
  const paragraphs = childNodes(tc, "subList").flatMap((list) =>
    childNodes(list, "p"),
  );
  return joinCellParts(paragraphsParts(paragraphs, ctx, mode, depth));
}

/**
 * 각주·미주처럼 문단 묶음을 한 줄 인라인 HTML로 그린다 (셀과 같은 규칙).
 * 문맥(본문/셀)의 "|" 처리를 그대로 이어받는다.
 */
export function renderInlineParagraphs(
  paragraphs: ReadonlyArray<XmlNode>,
  ctx: HwpxContext,
  mode: WalkMode,
): string {
  return joinCellParts(paragraphsParts(paragraphs, ctx, mode, 0));
}

function cellSpan(tc: XmlNode): { colSpan: number; rowSpan: number } {
  const span = childNode(tc, "cellSpan");
  const read = (name: string): number =>
    span ? Math.max(1, Number(attr(span, name)) || 1) : 1;
  return { colSpan: read("colSpan"), rowSpan: read("rowSpan") };
}

/**
 * GFM 표 셀은 colspan/rowspan을 표준 지원하지 않는다. HWPX 표는 colSpan>1로
 * 가로 병합, rowSpan>1로 세로 병합을 표현하므로, 모든 행의 셀 수가 달라져
 * GFM separator(첫 행 기준 컬럼 수)와 불일치 → 일부 셀이 잘려 보이는 문제가
 * 발생한다.
 *
 * 해결: 표를 (rows × cols) 균일 grid로 정규화한다.
 * - colSpan=N 셀은 첫 자리에 값, 이후 N-1자리는 병합 표기(←)로 padding
 * - rowSpan>1 셀은 후속 행의 해당 col 위치를 reserved로 표시해 병합 표기(↑)
 * - 모든 행을 max(grid width)로 후처리 padding하여 첫 행 separator와 일치
 */
function expandTableToGrid(
  tbl: XmlNode,
  ctx: HwpxContext,
  mode: WalkMode,
): Array<Array<string>> {
  // col 위치 → 남은 rowspan 카운트 (다음 행에서 병합 표기로 채워야 함)
  const reserved = new Map<number, number>();
  const expanded = childNodes(tbl, "tr").map((row) =>
    expandRow(childNodes(row, "tc"), reserved, ctx, mode),
  );

  // 모든 행을 maxCols로 padding — 병합이 아니라 행 길이 보정이므로 빈칸이다
  const maxCols = expanded.reduce(
    (max, cells) => Math.max(max, cells.length),
    0,
  );
  return expanded.map((cells) => [
    ...cells,
    ...new Array<string>(maxCols - cells.length).fill(""),
  ]);
}

/** 윗 행의 rowSpan이 차지한 자리면 병합 표기(↑)를 내고 남은 행 수를 줄인다 */
function takeReserved(reserved: Map<number, number>, col: number): boolean {
  const remaining = reserved.get(col) ?? 0;
  if (remaining <= 0) return false;
  if (remaining === 1) reserved.delete(col);
  else reserved.set(col, remaining - 1);
  return true;
}

/** 한 행을 grid 칸으로 펼친다 — `reserved`는 행을 넘어 이어지는 세로 병합 상태 */
function expandRow(
  tcs: ReadonlyArray<XmlNode>,
  reserved: Map<number, number>,
  ctx: HwpxContext,
  mode: WalkMode,
): Array<string> {
  const cells: Array<string> = [];
  let tcIdx = 0;
  while (tcIdx < tcs.length || (reserved.get(cells.length) ?? 0) > 0) {
    const col = cells.length;
    if (takeReserved(reserved, col)) {
      cells.push(MERGE_UP);
      continue;
    }
    const tc = tcs[tcIdx];
    tcIdx += 1;
    if (!tc) break;
    const { colSpan, rowSpan } = cellSpan(tc);
    cells.push(
      cellHtml(tc, ctx, mode, 0),
      ...new Array<string>(colSpan - 1).fill(MERGE_LEFT),
    );
    if (rowSpan > 1) {
      for (let c = col; c < col + colSpan; c += 1) reserved.set(c, rowSpan - 1);
    }
  }
  return cells;
}

/**
 * 본문 표를 HTML `<table>`로 그린다 (캡션은 호출측이 앞뒤에 놓는다).
 * @param depth 표가 놓인 자리의 개체 중첩 깊이 — 글상자 속 표도 한도를 이어 센다
 */
export function renderTableHtml(
  tbl: XmlNode,
  ctx: HwpxContext,
  depth: number,
): string {
  const grid = expandTableToGrid(tbl, ctx, cellMode(depth));
  if (grid.length === 0) return "";
  const rows = grid.map((cells, ri) => {
    const tag = ri === 0 ? "th" : "td";
    return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>\n`;
  });
  return `<table>\n${rows.join("")}</table>\n`;
}
