import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import {
  createImageAsset,
  imageToHtml,
  makeImageName,
  mimeFromExt,
} from "../image-utils.js";
import type {
  ImageAsset,
  ParseOptions,
  ParseResult,
  Parser,
} from "../types.js";

interface HwpxStyle {
  id: string;
  name: string;
}

const HEADING_PATTERNS: Array<{ pattern: RegExp; level: number }> = [
  { pattern: /^1\.\s*제목$/, level: 1 },
  { pattern: /^1\.1\s*부제목$/, level: 2 },
  { pattern: /^부제목2$/, level: 2 },
  { pattern: /^1\.1\.1\s*소제목$/, level: 3 },
];

const LIST_PATTERN = /^나열/;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (tagName) =>
    [
      "p",
      "run",
      "t",
      "tr",
      "tc",
      "tbl",
      "style",
      "charPr",
      "itemref",
      "item",
      "subList",
    ].includes(tagName),
});

function ensureArray<T>(value: T | Array<T> | undefined | null): Array<T> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getHeadingLevel(styleName: string): number | null {
  for (const { pattern, level } of HEADING_PATTERNS) {
    if (pattern.test(styleName)) return level;
  }
  return null;
}

// --- Style & CharPr parsing ---

function parseStyles(
  headerDoc: Record<string, unknown>,
): Map<string, HwpxStyle> {
  const map = new Map<string, HwpxStyle>();
  const head = headerDoc.head as Record<string, unknown> | undefined;
  if (!head) return map;

  const refList = head.refList as Record<string, unknown> | undefined;
  if (!refList) return map;

  const stylesNode = refList.styles as Record<string, unknown> | undefined;
  if (!stylesNode) return map;

  const styles = ensureArray(
    stylesNode.style as Array<Record<string, unknown>>,
  );
  for (const s of styles) {
    const id = String(s["@_id"] ?? "");
    if (id) {
      map.set(id, { id, name: String(s["@_name"] ?? "") });
    }
  }
  return map;
}

function parseBoldSet(headerDoc: Record<string, unknown>): Set<string> {
  const boldIds = new Set<string>();
  const head = headerDoc.head as Record<string, unknown> | undefined;
  if (!head) return boldIds;

  const refList = head.refList as Record<string, unknown> | undefined;
  if (!refList) return boldIds;

  const charPropsNode = refList.charProperties as
    | Record<string, unknown>
    | undefined;
  if (!charPropsNode) return boldIds;

  const charPrs = ensureArray(
    charPropsNode.charPr as Array<Record<string, unknown>>,
  );
  for (const cp of charPrs) {
    // HWPX represents bold as <bold/> empty element → parsed as bold: ""
    if (cp.bold !== undefined) {
      boldIds.add(String(cp["@_id"] ?? ""));
    }
  }
  return boldIds;
}

// --- Image extraction ---

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".svg",
  ".webp",
]);

function isImageFile(path: string): boolean {
  const ext = path.toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
  return IMAGE_EXTENSIONS.has(ext);
}

function extractImagesFromZip(
  files: Record<string, Uint8Array>,
): Map<string, { data: Uint8Array; originalPath: string }> {
  const imageMap = new Map<
    string,
    { data: Uint8Array; originalPath: string }
  >();
  for (const [path, data] of Object.entries(files)) {
    if (isImageFile(path) && data.length > 0) {
      // BinData/image01.png → image01.png (파일명만 키로 사용)
      const fileName = path.split("/").pop() ?? path;
      imageMap.set(fileName, { data, originalPath: path });
    }
  }
  return imageMap;
}

interface ImageCollector {
  images: Array<ImageAsset>;
  imagesDirName: string;
  zipImages: Map<string, { data: Uint8Array; originalPath: string }>;
  usedImages: Set<string>;
}

function collectImageFromRun(
  run: Record<string, unknown>,
  collector: ImageCollector,
): string | null {
  // HWPX에서 이미지 참조: <img> 또는 <pic> 요소의 binaryItemIDRef 속성
  const img = run.img as Record<string, unknown> | undefined;
  const pic = run.pic as Record<string, unknown> | undefined;
  const target = img ?? pic;
  if (!target) return null;

  let binRef = String(target["@_binaryItemIDRef"] ?? "");

  // pic 내부에 img가 중첩된 경우
  if (!binRef && pic) {
    const innerImg = pic.img as Record<string, unknown> | undefined;
    if (innerImg) {
      binRef = String(innerImg["@_binaryItemIDRef"] ?? "");
    }
  }

  if (!binRef) return null;

  // binRef로 ZIP 내 이미지 찾기 (파일명 매칭)
  const matchKey = [...collector.zipImages.keys()].find((k) => {
    const nameWithoutExt = k.replace(/\.[^.]+$/, "");
    return k === binRef || nameWithoutExt === binRef;
  });

  if (!matchKey || collector.usedImages.has(matchKey)) return null;

  const entry = collector.zipImages.get(matchKey);
  if (!entry) return null;

  collector.usedImages.add(matchKey);
  const idx = collector.images.length + 1;
  const ext = matchKey.toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
  const imageName = makeImageName(idx, ext);
  const mimeType = mimeFromExt(matchKey);

  collector.images.push(createImageAsset(imageName, entry.data, mimeType));
  return imageToHtml(collector.imagesDirName, imageName, matchKey);
}

// --- Text extraction ---

function extractTextFromRuns(
  runs: Array<Record<string, unknown>>,
  boldSet: Set<string>,
): string {
  let text = "";
  for (const run of runs) {
    const parts = ensureArray(run.t as Array<unknown>);
    let runText = parts
      .map((t) => {
        if (typeof t === "string") return t;
        if (typeof t === "number") return String(t);
        if (t && typeof t === "object")
          return String((t as Record<string, unknown>)["#text"] ?? "");
        return "";
      })
      .join("");

    if (!runText) continue;

    runText = escapeHtml(runText);
    const charPrId = String(run["@_charPrIDRef"] ?? "");
    if (boldSet.has(charPrId)) {
      runText = `<strong>${runText}</strong>`;
    }

    text += runText;
  }
  return text;
}

// --- Table parsing ---

function parseCellText(
  tc: Record<string, unknown>,
  boldSet: Set<string>,
  collector: ImageCollector,
): string {
  const subLists = ensureArray(tc.subList as Array<Record<string, unknown>>);
  const parts: Array<string> = [];

  for (const sl of subLists) {
    const paras = ensureArray(sl.p as Array<Record<string, unknown>>);
    for (const p of paras) {
      const runs = ensureArray(p.run as Array<Record<string, unknown>>);

      // 셀 내부 run에서 이미지 추출 (표 안의 그림이 누락되지 않도록)
      for (const run of runs) {
        const imgHtml = collectImageFromRun(run, collector);
        if (imgHtml) parts.push(imgHtml);
      }

      const t = extractTextFromRuns(runs, boldSet);
      if (t.trim()) parts.push(t);
    }
  }
  return parts.join("<br>");
}

function buildCellAttrs(tc: Record<string, unknown>): string {
  const spanNode = tc.cellSpan as Record<string, unknown> | undefined;
  const colSpan = spanNode ? Number(spanNode["@_colSpan"] ?? 1) : 1;
  const rowSpan = spanNode ? Number(spanNode["@_rowSpan"] ?? 1) : 1;
  let attrs = "";
  if (colSpan > 1) attrs += ` colspan="${colSpan}"`;
  if (rowSpan > 1) attrs += ` rowspan="${rowSpan}"`;
  return attrs;
}

function parseTableRow(
  tr: Record<string, unknown>,
  tag: string,
  boldSet: Set<string>,
  collector: ImageCollector,
): string {
  const cells = ensureArray(tr.tc as Array<Record<string, unknown>>);
  let html = "<tr>";
  for (const tc of cells) {
    const cellText = parseCellText(tc, boldSet, collector);
    const attrs = buildCellAttrs(tc);
    html += `<${tag}${attrs}>${cellText}</${tag}>`;
  }
  html += "</tr>\n";
  return html;
}

function parseTable(
  tbl: Record<string, unknown>,
  boldSet: Set<string>,
  collector: ImageCollector,
): string {
  const rows = ensureArray(tbl.tr as Array<Record<string, unknown>>);
  if (rows.length === 0) return "";

  let html = "<table>\n";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    html += parseTableRow(row, i === 0 ? "th" : "td", boldSet, collector);
  }
  html += "</table>\n";
  return html;
}

// --- Section parsing ---

function closeListIfNeeded(htmlParts: Array<string>, inList: boolean): boolean {
  if (inList) {
    htmlParts.push("</ul>\n");
  }
  return false;
}

function collectTablesFromRuns(
  runs: Array<Record<string, unknown>>,
  htmlParts: Array<string>,
  inList: boolean,
  boldSet: Set<string>,
  collector: ImageCollector,
): boolean {
  for (const run of runs) {
    const tables = ensureArray(run.tbl as Array<Record<string, unknown>>);
    for (const tbl of tables) {
      inList = closeListIfNeeded(htmlParts, inList);
      htmlParts.push(parseTable(tbl, boldSet, collector));
    }
  }
  return inList;
}

function renderParagraph(
  text: string,
  styleName: string,
  htmlParts: Array<string>,
  inList: boolean,
): boolean {
  // Heading
  const headingLevel = getHeadingLevel(styleName);
  if (headingLevel) {
    inList = closeListIfNeeded(htmlParts, inList);
    htmlParts.push(`<h${headingLevel}>${text}</h${headingLevel}>\n`);
    return inList;
  }

  // List
  if (LIST_PATTERN.test(styleName)) {
    if (!inList) {
      htmlParts.push("<ul>\n");
      inList = true;
    }
    htmlParts.push(`<li>${text}</li>\n`);
    return inList;
  }

  // Regular paragraph
  inList = closeListIfNeeded(htmlParts, inList);
  htmlParts.push(`<p>${text}</p>\n`);
  return inList;
}

function parseSectionToHtml(
  sectionXml: string,
  styles: Map<string, HwpxStyle>,
  boldSet: Set<string>,
  collector: ImageCollector,
): string {
  const doc = xmlParser.parse(sectionXml);
  const sec = doc.sec as Record<string, unknown> | undefined;
  if (!sec) return "";

  const paragraphs = ensureArray(sec.p as Array<Record<string, unknown>>);
  const htmlParts: Array<string> = [];
  let inList = false;

  for (const para of paragraphs) {
    const styleId = String(para["@_styleIDRef"] ?? "0");
    const styleName = styles.get(styleId)?.name ?? "";
    const runs = ensureArray(para.run as Array<Record<string, unknown>>);

    inList = collectTablesFromRuns(runs, htmlParts, inList, boldSet, collector);

    // 이미지 추출
    for (const run of runs) {
      const imgHtml = collectImageFromRun(run, collector);
      if (imgHtml) {
        inList = closeListIfNeeded(htmlParts, inList);
        htmlParts.push(`<p>${imgHtml}</p>\n`);
      }
    }

    const text = extractTextFromRuns(runs, boldSet);
    if (!text.trim()) {
      inList = closeListIfNeeded(htmlParts, inList);
      continue;
    }

    inList = renderParagraph(text, styleName, htmlParts, inList);
  }

  closeListIfNeeded(htmlParts, inList);
  return htmlParts.join("");
}

// --- Spine resolution ---

const DEFAULT_SECTIONS = ["Contents/section0.xml"];

function buildManifestMap(
  manifest: Record<string, unknown> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  const items = manifest
    ? ensureArray(manifest.item as Array<Record<string, unknown>>)
    : [];
  for (const item of items) {
    const id = String(item["@_id"] ?? "");
    const href = String(item["@_href"] ?? "");
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

function getSectionPaths(files: Record<string, Uint8Array>): Array<string> {
  const hpfKey = Object.keys(files).find((f) =>
    f.toLowerCase().endsWith("content.hpf"),
  );
  if (!hpfKey) return DEFAULT_SECTIONS;

  const hpfFile = files[hpfKey];
  if (!hpfFile) return DEFAULT_SECTIONS;

  const hpf = xmlParser.parse(strFromU8(hpfFile));
  const pkg = hpf.package as Record<string, unknown> | undefined;
  if (!pkg?.spine) return DEFAULT_SECTIONS;

  const spine = pkg.spine as Record<string, unknown>;
  const itemrefs = ensureArray(spine.itemref as Array<Record<string, unknown>>);
  const itemMap = buildManifestMap(
    pkg.manifest as Record<string, unknown> | undefined,
  );

  const prefix = hpfKey.includes("/")
    ? hpfKey.substring(0, hpfKey.lastIndexOf("/") + 1)
    : "";

  const paths: Array<string> = [];
  for (const ref of itemrefs) {
    const idref = String(ref["@_idref"] ?? "");
    const href = itemMap.get(idref);
    if (!href) continue;
    const resolved = resolveHref(href, prefix, files);
    if (resolved) paths.push(resolved);
  }

  return paths.length > 0 ? paths : DEFAULT_SECTIONS;
}

// --- Parser ---

export class HwpxParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const buffer = await readFile(inputPath);
    const files = unzipSync(new Uint8Array(buffer));

    // Parse header for styles and bold character properties
    const headerKey = Object.keys(files).find((f) =>
      f.toLowerCase().endsWith("header.xml"),
    );
    let styles = new Map<string, HwpxStyle>();
    let boldSet = new Set<string>();

    const headerFile = headerKey ? files[headerKey] : undefined;
    if (headerFile) {
      const headerDoc = xmlParser.parse(strFromU8(headerFile)) as Record<
        string,
        unknown
      >;
      styles = parseStyles(headerDoc);
      boldSet = parseBoldSet(headerDoc);
    }

    // 이미지 수집 준비
    const zipImages = extractImagesFromZip(files);
    const collector: ImageCollector = {
      images: [],
      imagesDirName: options.imagesDirName,
      zipImages,
      usedImages: new Set(),
    };

    // Parse all sections
    const sectionPaths = getSectionPaths(files);
    const htmlParts: Array<string> = [];

    for (const path of sectionPaths) {
      const sectionFile = files[path];
      if (!sectionFile) continue;
      const sectionXml = strFromU8(sectionFile);
      htmlParts.push(
        parseSectionToHtml(sectionXml, styles, boldSet, collector),
      );
    }

    const html = htmlParts.join("\n");

    return {
      html: html || null,
      markdown: null,
      images: collector.images,
    };
  }
}
