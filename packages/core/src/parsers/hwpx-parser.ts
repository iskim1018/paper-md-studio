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

interface CharStyles {
  readonly boldIds: Set<string>;
  readonly strikeIds: Set<string>;
}

function emptyCharStyles(): CharStyles {
  return { boldIds: new Set<string>(), strikeIds: new Set<string>() };
}

function parseCharStyles(headerDoc: Record<string, unknown>): CharStyles {
  const styles = emptyCharStyles();
  const head = headerDoc.head as Record<string, unknown> | undefined;
  if (!head) return styles;

  const refList = head.refList as Record<string, unknown> | undefined;
  if (!refList) return styles;

  const charPropsNode = refList.charProperties as
    | Record<string, unknown>
    | undefined;
  if (!charPropsNode) return styles;

  const charPrs = ensureArray(
    charPropsNode.charPr as Array<Record<string, unknown>>,
  );
  for (const cp of charPrs) {
    const id = String(cp["@_id"] ?? "");
    // <bold/>는 빈 element를 on 마커로만 사용 (parsed as "")
    if (cp.bold !== undefined) {
      styles.boldIds.add(id);
    }
    // 실제 한컴 HWPX는 모든 charPr이 <strikeout shape="..."/>를 포함한다.
    // shape="NONE"이면 적용 안 됨, SOLID/DOT/DASH 등이면 적용됨.
    // 속성 없이 bare <strikeout/>인 경우는 parsed as ""이므로 on으로 간주.
    if (isStrikeEnabled(cp.strikeout)) {
      styles.strikeIds.add(id);
    }
  }
  return styles;
}

function isStrikeEnabled(strikeout: unknown): boolean {
  if (strikeout === undefined || strikeout === null) return false;
  // bare <strikeout/> → parsed as "" (빈 문자열)
  if (typeof strikeout !== "object") return true;
  const shape = (strikeout as Record<string, unknown>)["@_shape"];
  if (shape === undefined) return true;
  return shape !== "NONE";
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

function extractRawRunText(run: Record<string, unknown>): string {
  const parts = ensureArray(run.t as Array<unknown>);
  return parts
    .map((t) => {
      if (typeof t === "string") return t;
      if (typeof t === "number") return String(t);
      if (t && typeof t === "object")
        return String((t as Record<string, unknown>)["#text"] ?? "");
      return "";
    })
    .join("");
}

interface TagState {
  strongOpen: boolean;
  delOpen: boolean;
}

/**
 * 현재 열려 있는 태그 상태에서 목표 상태로 전환하기 위한 HTML 조각을
 * 계산하고 state를 in-place로 갱신한다. strong이 바뀌면 모든 태그를
 * 닫고 새로 연다(중첩 순서 유지). del만 바뀌면 del만 토글.
 */
function transitionTags(
  state: TagState,
  wantStrong: boolean,
  wantDel: boolean,
): string {
  let out = "";
  if (wantStrong !== state.strongOpen) {
    if (state.delOpen) {
      out += "</del>";
      state.delOpen = false;
    }
    if (state.strongOpen) {
      out += "</strong>";
      state.strongOpen = false;
    }
    if (wantStrong) {
      out += "<strong>";
      state.strongOpen = true;
    }
  }
  if (wantDel !== state.delOpen) {
    if (state.delOpen) {
      out += "</del>";
      state.delOpen = false;
    }
    if (wantDel) {
      out += "<del>";
      state.delOpen = true;
    }
  }
  return out;
}

/**
 * runs를 순회하면서 동일한 스타일(bold/strike)이 이어지면 하나의
 * 태그로 감싸고, 스타일이 바뀌면 해당 태그만 닫고 다시 연다.
 * 최외곽 태그는 <strong>, 내부 태그는 <del>로 중첩 순서를 고정.
 *
 * 예: [bold, bold, bold+strike, bold] →
 *   <strong>t1t2<del>t3</del>t4</strong>
 *
 * 이렇게 해서 turndown이 `**t1t2~~t3~~t4**`로 단일 블록을 생성한다.
 */
function extractTextFromRuns(
  runs: Array<Record<string, unknown>>,
  charStyles: CharStyles,
): string {
  let text = "";
  const state: TagState = { strongOpen: false, delOpen: false };

  for (const run of runs) {
    const runText = extractRawRunText(run);
    if (!runText) continue;
    const charPrId = String(run["@_charPrIDRef"] ?? "");
    text += transitionTags(
      state,
      charStyles.boldIds.has(charPrId),
      charStyles.strikeIds.has(charPrId),
    );
    text += escapeHtml(runText);
  }

  // 남은 태그 닫기 (내부→외부)
  if (state.delOpen) text += "</del>";
  if (state.strongOpen) text += "</strong>";

  return text;
}

// --- Table parsing ---

function parseCellText(
  tc: Record<string, unknown>,
  charStyles: CharStyles,
  collector: ImageCollector,
): string {
  const subLists = ensureArray(tc.subList as Array<Record<string, unknown>>);
  const imageParts: Array<string> = [];
  const textParts: Array<string> = [];

  for (const sl of subLists) {
    const paras = ensureArray(sl.p as Array<Record<string, unknown>>);
    for (const p of paras) {
      const runs = ensureArray(p.run as Array<Record<string, unknown>>);

      // 셀 내부 run에서 이미지 추출 (표 안의 그림이 누락되지 않도록)
      for (const run of runs) {
        const imgHtml = collectImageFromRun(run, collector);
        if (imgHtml) imageParts.push(imgHtml);
      }

      const t = extractTextFromRuns(runs, charStyles);
      if (t.trim()) textParts.push(t);
    }
  }

  // GFM 테이블 셀 내부에 하드 브레이크(`  \n`)가 들어가면 테이블 구조가
  // 깨지므로, 다중 paragraph는 공백으로 flatten한다. 3개 이상이면 항목
  // 구분을 위해 "/"를 경계 표시로 사용해 가독성을 유지한다. 이미지는
  // 텍스트 앞에 공백으로 붙인다.
  const textJoined =
    textParts.length <= 2 ? textParts.join(" ") : textParts.join(" / ");

  const allParts = [...imageParts, textJoined].filter((s) => s.length > 0);
  return allParts.join(" ");
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
  charStyles: CharStyles,
  collector: ImageCollector,
): string {
  const cells = ensureArray(tr.tc as Array<Record<string, unknown>>);
  let html = "<tr>";
  for (const tc of cells) {
    const cellText = parseCellText(tc, charStyles, collector);
    const attrs = buildCellAttrs(tc);
    html += `<${tag}${attrs}>${cellText}</${tag}>`;
  }
  html += "</tr>\n";
  return html;
}

function parseTable(
  tbl: Record<string, unknown>,
  charStyles: CharStyles,
  collector: ImageCollector,
): string {
  const rows = ensureArray(tbl.tr as Array<Record<string, unknown>>);
  if (rows.length === 0) return "";

  let html = "<table>\n";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    html += parseTableRow(row, i === 0 ? "th" : "td", charStyles, collector);
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
  charStyles: CharStyles,
  collector: ImageCollector,
): boolean {
  for (const run of runs) {
    const tables = ensureArray(run.tbl as Array<Record<string, unknown>>);
    for (const tbl of tables) {
      inList = closeListIfNeeded(htmlParts, inList);
      htmlParts.push(parseTable(tbl, charStyles, collector));
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
  charStyles: CharStyles,
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

    inList = collectTablesFromRuns(
      runs,
      htmlParts,
      inList,
      charStyles,
      collector,
    );

    // 이미지 추출
    for (const run of runs) {
      const imgHtml = collectImageFromRun(run, collector);
      if (imgHtml) {
        inList = closeListIfNeeded(htmlParts, inList);
        htmlParts.push(`<p>${imgHtml}</p>\n`);
      }
    }

    const text = extractTextFromRuns(runs, charStyles);
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
    let charStyles: CharStyles = emptyCharStyles();

    const headerFile = headerKey ? files[headerKey] : undefined;
    if (headerFile) {
      const headerDoc = xmlParser.parse(strFromU8(headerFile)) as Record<
        string,
        unknown
      >;
      styles = parseStyles(headerDoc);
      charStyles = parseCharStyles(headerDoc);
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
        parseSectionToHtml(sectionXml, styles, charStyles, collector),
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
