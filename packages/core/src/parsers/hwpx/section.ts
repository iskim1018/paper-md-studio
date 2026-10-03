import {
  BODY_MODE,
  type HwpxContext,
  MAX_OBJECT_DEPTH,
  type WalkMode,
} from "./context.js";
import { tableCaption } from "./controls.js";
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

/** 본문 HTML을 쌓으며 `<ul>` 목록이 열려 있는지 추적한다 */
class BodyWriter {
  private readonly parts: Array<string> = [];
  private inList = false;

  block(html: string): void {
    if (!html) return;
    this.closeList();
    this.parts.push(html);
  }

  listItem(html: string): void {
    if (!this.inList) {
      this.parts.push("<ul>\n");
      this.inList = true;
    }
    this.parts.push(`<li>${html}</li>\n`);
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
  html: string,
): void {
  if (kind.heading) {
    const tag = `h${kind.heading}`;
    writer.block(`<${tag}>${html}</${tag}>\n`);
  } else if (kind.list) {
    writer.listItem(html);
  } else {
    writer.block(`<p>${html}</p>\n`);
  }
}

function writeTable(
  tbl: XmlNode,
  ctx: HwpxContext,
  writer: BodyWriter,
  mode: WalkMode,
): void {
  const caption = tableCaption(tbl);
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
      writeTable(segment.node, ctx, writer, mode);
      return;
    case "paragraphs":
      writeParagraphs(segment.paragraphs, ctx, writer, {
        ...mode,
        depth: mode.depth + 1,
      });
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
      writeInline(writer, kind, segment.html);
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

/** 섹션 XML 파싱 결과를 본문 HTML로 그린다 */
export function renderSection(sectionDoc: XmlNode, ctx: HwpxContext): string {
  const sec = sectionDoc.sec;
  if (!isXmlNode(sec)) return "";
  const paragraphs = childNodes(sec, "p");
  ctx.state.startSection();
  const writer = new BodyWriter();
  writeParagraphs(paragraphs, ctx, writer, BODY_MODE);
  return writer.toHtml();
}
