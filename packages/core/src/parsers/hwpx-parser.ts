import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { htmlToMarkdown } from "../html-to-md.js";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { PIPE_TOKEN, restorePipes } from "./html-tables-to-gfm.js";
import { DocumentState, type HwpxContext } from "./hwpx/context.js";
import { emptyHeader, type HwpxHeader, readHeader } from "./hwpx/header.js";
import { ImageCollector } from "./hwpx/images.js";
import { NumberingTracker } from "./hwpx/numbering.js";
import { renderSection } from "./hwpx/section.js";
import { renderInlineParagraphs } from "./hwpx/table.js";
import {
  attr,
  childNodes,
  isXmlNode,
  parseHeaderXml,
  parseSectionXml,
  type XmlNode,
} from "./hwpx/xml.js";

/**
 * 자체 HWPX(OWPML) 파서 — 본문을 HTML로 그린 뒤 Markdown으로 내린다.
 *
 * 이 파일은 조립만 한다. 실제 해석은 `hwpx/` 아래 모듈이 맡는다.
 * - `xml.ts`: 섹션·헤더 XML 파서 설정과 문서 순서 복원
 * - `inline-tokens.ts`·`inline-builder.ts`: `<hp:t>` 안쪽(탭·줄바꿈·변경 추적)
 * - `walker.ts`: 문단 하나를 문서 순서대로 훑기 (표·그림·수식·글상자·각주·링크)
 * - `table.ts`·`section.ts`: 표 셀 평탄화와 본문 블록 렌더링
 * - `header.ts`·`numbering.ts`: 스타일·글자 모양·문단 머리(글머리표·번호)
 * - `images.ts`·`equation.ts`·`controls.ts`: 그림·수식·조판 부호
 */

const DEFAULT_SECTIONS = ["Contents/section0.xml"];
const DEFAULT_IMAGES_DIR = "images";

const NO_TEXT_WARNING =
  "추출할 본문 텍스트가 없습니다. 그림이나 그리기 개체만 있는 문서일 수 있습니다.";

function buildManifestMap(manifest: XmlNode | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of manifest ? childNodes(manifest, "item") : []) {
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (id && href) map.set(id, href);
  }
  return map;
}

function resolveHref(
  href: string,
  prefix: string,
  files: Record<string, Uint8Array>,
): string | null {
  if (href.toLowerCase().endsWith("header.xml")) return null;
  if (files[href]) return href;
  const prefixed = `${prefix}${href}`;
  if (files[prefixed]) return prefixed;
  return null;
}

/** content.hpf의 spine 순서대로 섹션 파일 경로를 찾는다 */
function getSectionPaths(files: Record<string, Uint8Array>): Array<string> {
  const hpfKey = Object.keys(files).find((f) =>
    f.toLowerCase().endsWith("content.hpf"),
  );
  const hpfFile = hpfKey ? files[hpfKey] : undefined;
  if (!hpfKey || !hpfFile) return DEFAULT_SECTIONS;

  const pkg = parseHeaderXml(strFromU8(hpfFile)).package;
  if (!isXmlNode(pkg) || !isXmlNode(pkg.spine)) return DEFAULT_SECTIONS;

  const itemMap = buildManifestMap(
    isXmlNode(pkg.manifest) ? pkg.manifest : undefined,
  );
  const prefix = hpfKey.includes("/")
    ? hpfKey.substring(0, hpfKey.lastIndexOf("/") + 1)
    : "";

  const paths = childNodes(pkg.spine, "itemref")
    .map((ref) => itemMap.get(attr(ref, "idref")))
    .map((href) => (href ? resolveHref(href, prefix, files) : null))
    .filter((path): path is string => path !== null);
  return paths.length > 0 ? paths : DEFAULT_SECTIONS;
}

function readHeaderFile(files: Record<string, Uint8Array>): HwpxHeader {
  const key = Object.keys(files).find((f) =>
    f.toLowerCase().endsWith("header.xml"),
  );
  const file = key ? files[key] : undefined;
  return file ? readHeader(parseHeaderXml(strFromU8(file))) : emptyHeader();
}

function unzip(data: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `HWPX 파일을 열 수 없습니다 (손상되었거나 ZIP 형식이 아닙니다): ${detail}`,
    );
  }
}

function renderSectionFile(
  path: string,
  xml: string,
  ctx: HwpxContext,
): string {
  let doc: XmlNode;
  try {
    doc = parseSectionXml(xml);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`HWPX 본문(${path})을 해석할 수 없습니다: ${detail}`);
  }
  return renderSection(doc, ctx);
}

function hasVisibleText(html: string): boolean {
  return /\S/.test(html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " "));
}

function collectWarnings(ctx: HwpxContext, html: string): Array<string> {
  const warnings: Array<string> = [];
  if (!hasVisibleText(html)) warnings.push(NO_TEXT_WARNING);
  const { deletedRanges, equationFallbacks } = ctx.state;
  if (deletedRanges > 0) {
    warnings.push(
      `변경 내용 추적으로 삭제 표시된 텍스트 ${deletedRanges}곳을 제외했습니다.`,
    );
  }
  if (ctx.images.skippedMetafiles > 0) {
    warnings.push(
      `WMF/EMF 그림 ${ctx.images.skippedMetafiles}개는 변환할 수 없어 제외했습니다.`,
    );
  }
  if (equationFallbacks > 0) {
    warnings.push(
      `수식 ${equationFallbacks}개는 LaTeX로 바꾸지 못해 원본 수식 스크립트를 코드로 남겼습니다.`,
    );
  }
  return [...new Set(warnings)];
}

function createContext(
  files: Record<string, Uint8Array>,
  imagesDirName: string,
): HwpxContext {
  const ctx: HwpxContext = {
    header: readHeaderFile(files),
    images: new ImageCollector(imagesDirName, files),
    numbering: new NumberingTracker(),
    state: new DocumentState(),
    renderNote: (paragraphs, mode) =>
      renderInlineParagraphs(paragraphs, ctx, mode),
  };
  return ctx;
}

export class HwpxParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    return this.parseBytes(new Uint8Array(buffer), options);
  }

  /**
   * 메모리의 HWPX 바이트를 바로 파싱한다 — HWP를 HWPX로 바꾼 결과를 임시
   * 파일 없이 넘기는 경로용이다.
   *
   * html(뷰어용)과 markdown을 함께 돌려준다. 표 셀의 "|"는 turndown을 거친
   * 뒤에야 "\|"로 되돌릴 수 있어(그 전에 escape하면 "\\|"로 이중 escape된다)
   * Markdown 변환까지 여기서 끝낸다 — DOCX 파서와 같은 계약이다.
   */
  async parseBytes(
    data: Uint8Array,
    options: ParseOptions = { imagesDirName: DEFAULT_IMAGES_DIR },
  ): Promise<ParseResult> {
    const files = unzip(data);
    const ctx = createContext(files, options.imagesDirName);

    const htmlParts: Array<string> = [];
    for (const path of getSectionPaths(files)) {
      const sectionFile = files[path];
      if (!sectionFile) continue;
      htmlParts.push(renderSectionFile(path, strFromU8(sectionFile), ctx));
    }

    const protectedHtml = htmlParts.join("\n");
    const html = protectedHtml.split(PIPE_TOKEN).join("|");
    const markdown = restorePipes(htmlToMarkdown(protectedHtml));
    const warnings = collectWarnings(ctx, html);

    return {
      html: hasVisibleText(html) || ctx.images.images.length > 0 ? html : "",
      markdown,
      images: ctx.images.images,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
