import {
  BODY_MODE,
  type HwpxContext,
  MAX_OBJECT_DEPTH,
  type WalkMode,
} from "./context.js";
import { captionOf } from "./controls.js";
import {
  type OrderedListTracker,
  type OrderedMarker,
  orderedMarker,
  withMarker,
} from "./marker.js";
import { type ParagraphMarker, resolveParagraphMarker } from "./numbering.js";
import { renderTableHtml } from "./table.js";
import { type Segment, walkParagraph } from "./walker.js";
import { attr, childNodes, isXmlNode, type XmlNode } from "./xml.js";

const HEADING_PATTERNS: ReadonlyArray<{ pattern: RegExp; level: number }> = [
  { pattern: /^1\.\s*제목$/, level: 1 },
  { pattern: /^1\.1\s*부제목$/, level: 2 },
  { pattern: /^부제목2$/, level: 2 },
  { pattern: /^1\.1\.1\s*소제목$/, level: 3 },
];

const LIST_PATTERN = /^나열/;

function headingLevel(styleName: string): number | null {
  return (
    HEADING_PATTERNS.find(({ pattern }) => pattern.test(styleName))?.level ??
    null
  );
}

/** 본문 HTML을 쌓으며 `<ul>` 목록과 번호 목록의 이어짐을 추적한다 */
class BodyWriter {
  private readonly parts: Array<string> = [];
  private inList = false;

  constructor(private readonly ordered: OrderedListTracker) {}

  block(html: string): void {
    if (!html) return;
    this.closeList();
    this.parts.push(html);
    this.ordered.wrote(null);
  }

  /**
   * 번호 문단 — 렌더러에서 같은 번호로 보이면 번호를 날것(목록)으로, 아니면
   * 글자로 낸다 (`render(asText)`).
   */
  orderedParagraph(
    marker: OrderedMarker,
    render: (asText: boolean) => string,
  ): void {
    const asIs = this.ordered.rendersAsIs(marker);
    this.block(render(!asIs));
    this.ordered.wrote(asIs ? marker : null);
  }

  listItem(html: string): void {
    if (!this.inList) {
      this.parts.push("<ul>\n");
      this.inList = true;
    }
    this.parts.push(`<li>${html}</li>\n`);
    this.ordered.wrote(null);
  }

  closeList(): void {
    if (!this.inList) return;
    this.parts.push("</ul>\n");
    this.inList = false;
  }

  toHtml(): string {
    this.closeList();
    return this.parts.join("");
  }
}

interface ParagraphKind {
  readonly heading: number | null;
  readonly list: boolean;
}

function writeInline(
  writer: BodyWriter,
  kind: ParagraphKind,
  marker: ParagraphMarker | null,
  html: string,
): void {
  if (kind.heading) {
    const tag = `h${kind.heading}`;
    const inner = withMarker(marker?.text ?? null, html, "heading");
    writer.block(`<${tag}>${inner}</${tag}>\n`);
    return;
  }
  if (kind.list) {
    // 목록 항목은 이미 "- "가 붙으므로 글머리표를 겹쳐 붙이지 않는다
    const number = marker?.kind === "number" ? marker.text : null;
    writer.listItem(withMarker(number, html, "paragraph"));
    return;
  }
  const text = marker?.text ?? null;
  const paragraph = (asText: boolean): string =>
    `<p>${withMarker(text, html, "paragraph", asText)}</p>\n`;
  const ordered =
    marker?.kind === "number" && text ? orderedMarker(text) : null;
  if (ordered) writer.orderedParagraph(ordered, paragraph);
  else writer.block(paragraph(false));
}

function writeTable(
  tbl: XmlNode,
  ctx: HwpxContext,
  writer: BodyWriter,
  mode: WalkMode,
): void {
  const caption = captionOf(tbl);
  const captionMode = { ...mode, depth: mode.depth + 1 };
  const writeCaption = (): void => {
    if (caption && captionMode.depth <= MAX_OBJECT_DEPTH) {
      writeParagraphs(caption.paragraphs, ctx, writer, captionMode);
    }
  };
  if (caption?.before) writeCaption();
  writer.block(renderTableHtml(tbl, ctx, mode.depth));
  if (caption && !caption.before) writeCaption();
}

function writeSegment(
  segment: Segment,
  ctx: HwpxContext,
  writer: BodyWriter,
  mode: WalkMode,
): void {
  switch (segment.kind) {
    case "image":
      writer.block(`<p>${segment.html}</p>\n`);
      return;
    case "table":
      ctx.state.withoutDeletion(() =>
        writeTable(segment.node, ctx, writer, mode),
      );
      return;
    case "paragraphs":
      ctx.state.withoutDeletion(() =>
        writeParagraphs(segment.paragraphs, ctx, writer, {
          ...mode,
          depth: mode.depth + 1,
        }),
      );
      return;
    default:
      return;
  }
}

function writeParagraph(
  paragraph: XmlNode,
  ctx: HwpxContext,
  writer: BodyWriter,
  mode: WalkMode,
): void {
  const styleName =
    ctx.header.styleNames.get(attr(paragraph, "styleIDRef") || "0") ?? "";
  const kind: ParagraphKind = {
    heading: headingLevel(styleName),
    list: LIST_PATTERN.test(styleName),
  };
  // 번호는 내용이 없는 문단에서도 하나 소비된다 — 그래서 먼저 해석한다
  let marker = resolveParagraphMarker(
    attr(paragraph, "paraPrIDRef"),
    ctx.header,
    ctx.numbering,
    ctx.state.outlineNumberingId,
  );
  const segments = walkParagraph(paragraph, ctx, {
    ...mode,
    inHeading: kind.heading !== null,
  });
  if (segments.length === 0) {
    writer.closeList();
    return;
  }
  for (const segment of segments) {
    if (segment.kind === "inline") {
      writeInline(writer, kind, marker, segment.html);
      marker = null;
    } else {
      writeSegment(segment, ctx, writer, mode);
    }
  }
}

function writeParagraphs(
  paragraphs: ReadonlyArray<XmlNode>,
  ctx: HwpxContext,
  writer: BodyWriter,
  mode: WalkMode,
): void {
  for (const paragraph of paragraphs) {
    writeParagraph(paragraph, ctx, writer, mode);
  }
}

/** 구역 첫 문단의 `<hp:secPr outlineShapeIDRef>` — 개요 문단의 번호 체계 */
function outlineNumberingId(paragraphs: ReadonlyArray<XmlNode>): string {
  const first = paragraphs[0];
  if (!first) return "";
  for (const run of childNodes(first, "run")) {
    const secPr = run.secPr;
    if (isXmlNode(secPr)) return attr(secPr, "outlineShapeIDRef");
  }
  return "";
}

/** 섹션 XML 파싱 결과를 본문 HTML로 그린다 */
export function renderSection(sectionDoc: XmlNode, ctx: HwpxContext): string {
  const sec = sectionDoc.sec;
  if (!isXmlNode(sec)) return "";
  const paragraphs = childNodes(sec, "p");
  ctx.state.startSection(outlineNumberingId(paragraphs));
  const writer = new BodyWriter(ctx.state.orderedList);
  writeParagraphs(paragraphs, ctx, writer, BODY_MODE);
  return writer.toHtml();
}
