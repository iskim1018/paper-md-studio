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
  readonly italicIds: Set<string>;
  readonly strikeIds: Set<string>;
}

function emptyCharStyles(): CharStyles {
  return {
    boldIds: new Set<string>(),
    italicIds: new Set<string>(),
    strikeIds: new Set<string>(),
  };
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
    // <bold/>, <italic/>는 빈 element를 on 마커로만 사용 (parsed as "")
    if (cp.bold !== undefined) {
      styles.boldIds.add(id);
    }
    if (cp.italic !== undefined) {
      styles.italicIds.add(id);
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

/**
 * HWPX strikeout 스펙의 유효한 line pattern shape 목록.
 * 이 외의 값(NONE, 3D 등)은 취소선이 적용되지 않은 것으로 간주한다.
 * "3D"는 HWP의 text effect placeholder이고, "NONE"은 명시적 비적용.
 */
const STRIKE_LINE_SHAPES = new Set([
  "SOLID",
  "DOT",
  "DASH",
  "DASH_DOT",
  "DASH_DOT_DOT",
  "LONG_DASH",
  "CIRCLE",
  "DOUBLE_LINE",
  "DOUBLE_SLIM_LINE",
  "SLIM_THICK_LINE",
  "THICK_SLIM_LINE",
  "SLIM_THICK_SLIM_LINE",
]);

function isStrikeEnabled(strikeout: unknown): boolean {
  if (strikeout === undefined || strikeout === null) return false;
  // bare <strikeout/> → parsed as "" (빈 문자열), 구버전 호환으로 enabled 처리
  if (typeof strikeout !== "object") return true;
  const shape = (strikeout as Record<string, unknown>)["@_shape"];
  // shape 속성이 없는 empty object도 on 마커로 간주
  if (shape === undefined) return true;
  if (typeof shape !== "string") return false;
  return STRIKE_LINE_SHAPES.has(shape);
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
  emOpen: boolean;
  delOpen: boolean;
}

/**
 * 현재 열려 있는 태그 상태에서 목표 상태로 전환하기 위한 HTML 조각을
 * 계산하고 state를 in-place로 갱신한다.
 *
 * 간결함을 위해 어느 상태라도 바뀌면 모든 태그를 내부→외부 순으로 닫고
 * 목표 상태의 태그를 외부→내부 순(strong → em → del)으로 다시 연다.
 * 연속 동일 스타일은 state 비교에서 걸러져 그대로 텍스트만 append된다.
 */
function transitionTags(
  state: TagState,
  wantStrong: boolean,
  wantEm: boolean,
  wantDel: boolean,
): string {
  if (
    wantStrong === state.strongOpen &&
    wantEm === state.emOpen &&
    wantDel === state.delOpen
  ) {
    return "";
  }

  let out = "";
  if (state.delOpen) {
    out += "</del>";
    state.delOpen = false;
  }
  if (state.emOpen) {
    out += "</em>";
    state.emOpen = false;
  }
  if (state.strongOpen) {
    out += "</strong>";
    state.strongOpen = false;
  }
  if (wantStrong) {
    out += "<strong>";
    state.strongOpen = true;
  }
  if (wantEm) {
    out += "<em>";
    state.emOpen = true;
  }
  if (wantDel) {
    out += "<del>";
    state.delOpen = true;
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
  const state: TagState = {
    strongOpen: false,
    emOpen: false,
    delOpen: false,
  };

  for (const run of runs) {
    const runText = extractRawRunText(run);
    if (!runText) continue;
    const charPrId = String(run["@_charPrIDRef"] ?? "");
    text += transitionTags(
      state,
      charStyles.boldIds.has(charPrId),
      charStyles.italicIds.has(charPrId),
      charStyles.strikeIds.has(charPrId),
    );
    text += escapeHtml(runText);
  }

  // 남은 태그 닫기 (내부→외부)
  if (state.delOpen) text += "</del>";
  if (state.emOpen) text += "</em>";
  if (state.strongOpen) text += "</strong>";

  return text;
}

// --- Table parsing ---

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

function flattenTableToText(
  tbl: Record<string, unknown>,
  charStyles: CharStyles,
  collector: ImageCollector,
  depth: number,
): string {
  const rows = ensureArray(tbl.tr as Array<Record<string, unknown>>);
  if (rows.length === 0) return "";

  const rowCount = rows.length;
  const firstRow = rows[0];
  const colCount = firstRow
    ? ensureArray(firstRow.tc as Array<Record<string, unknown>>).length
    : 0;
  const meta = `(표 ${rowCount}×${colCount})`;

  if (depth >= MAX_NEST_DEPTH) {
    return `${meta} 깊이 초과 생략`;
  }

  const rowTexts: Array<string> = [];
  for (const row of rows) {
    const cells = ensureArray(row.tc as Array<Record<string, unknown>>);
    const cellTexts: Array<string> = [];
    for (const tc of cells) {
      const cellText = parseCellText(tc, charStyles, collector, depth + 1);
      cellTexts.push(cellText.trim());
    }
    rowTexts.push(cellTexts.join(NESTED_CELL_SEP));
  }

  return `${meta}${NESTED_ROW_SEP}${rowTexts.join(NESTED_ROW_SEP)}`;
}

interface CellPart {
  readonly kind: "text" | "nested-table";
  readonly value: string;
}

function collectRunsFromRuns(
  runs: Array<Record<string, unknown>>,
  charStyles: CharStyles,
  collector: ImageCollector,
  depth: number,
  imageParts: Array<string>,
  parts: Array<CellPart>,
): void {
  for (const run of runs) {
    const imgHtml = collectImageFromRun(run, collector);
    if (imgHtml) imageParts.push(imgHtml);

    const nestedTables = ensureArray(run.tbl as Array<Record<string, unknown>>);
    for (const nested of nestedTables) {
      const flat = flattenTableToText(nested, charStyles, collector, depth);
      if (flat) parts.push({ kind: "nested-table", value: flat });
    }
  }
}

/**
 * 셀 출력 부분들을 결합한다. 중첩 표 항목은 앞뒤에 <br>을 두어
 * 텍스트와 시각적으로 분리하고, 일반 텍스트끼리는 공백 또는 " / "로 묶는다.
 * 한 paragraph 안에 텍스트와 중첩 표가 섞인 드문 케이스는 등장 순서를 보존한다.
 */
function joinCellParts(parts: ReadonlyArray<CellPart>): string {
  if (parts.length === 0) return "";

  const textOnly = parts.filter((p) => p.kind === "text").map((p) => p.value);
  const hasNestedTable = parts.some((p) => p.kind === "nested-table");

  if (!hasNestedTable) {
    return textOnly.length <= 2 ? textOnly.join(" ") : textOnly.join(" / ");
  }

  // 중첩 표가 있으면 등장 순서대로 출력하고, 텍스트 묶음과 표 사이에
  // <br>로 줄바꿈을 넣어 가독성을 확보한다.
  const segments: Array<string> = [];
  let buffer: Array<string> = [];
  const flushBuffer = () => {
    if (buffer.length === 0) return;
    segments.push(buffer.length <= 2 ? buffer.join(" ") : buffer.join(" / "));
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

/**
 * 셀 내부 텍스트의 "|"는 부모 GFM 표의 컬럼 구분자와 충돌해 표를 깨므로
 * "\|"로 escape한다. HTML 단계에서 turndown은 escape된 "\|"를 그대로
 * 유지해주므로 GFM 출력에서도 안전하다.
 */
function escapePipeInCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function parseCellText(
  tc: Record<string, unknown>,
  charStyles: CharStyles,
  collector: ImageCollector,
  depth = 0,
): string {
  const subLists = ensureArray(tc.subList as Array<Record<string, unknown>>);
  const imageParts: Array<string> = [];
  const parts: Array<CellPart> = [];

  for (const sl of subLists) {
    const paras = ensureArray(sl.p as Array<Record<string, unknown>>);
    for (const p of paras) {
      const runs = ensureArray(p.run as Array<Record<string, unknown>>);

      // 셀 내부 run에서 이미지 및 중첩 표 추출
      collectRunsFromRuns(
        runs,
        charStyles,
        collector,
        depth,
        imageParts,
        parts,
      );

      const t = extractTextFromRuns(runs, charStyles);
      // "|"는 push 시점에 한 번만 escape — 중첩 호출에서 이중 escape 방지.
      if (t.trim()) parts.push({ kind: "text", value: escapePipeInCell(t) });
    }
  }

  const joined = joinCellParts(parts);
  const allParts = [...imageParts, joined].filter((s) => s.length > 0);
  return allParts.join(" ");
}

/**
 * GFM 표 셀은 colspan/rowspan을 표준 지원하지 않는다. HWPX 표는 colSpan>1로
 * 가로 병합, rowSpan>1로 세로 병합을 표현하므로, 모든 행의 셀 수가 달라져
 * GFM separator(첫 행 기준 컬럼 수)와 불일치 → 일부 셀이 잘려 보이는 문제가
 * 발생한다.
 *
 * 해결: 표를 (rows × cols) 균일 grid로 정규화한다.
 * - colSpan=N 셀은 첫 자리에 값, 이후 N-1자리는 빈 셀로 padding
 * - rowSpan>1 셀은 후속 행의 해당 col 위치를 reserved로 표시해 빈 셀 padding
 * - 모든 행을 max(grid width)로 후처리 padding하여 첫 행 separator와 일치
 */
function expandTableToGrid(
  tbl: Record<string, unknown>,
  charStyles: CharStyles,
  collector: ImageCollector,
): Array<Array<string>> {
  const rows = ensureArray(tbl.tr as Array<Record<string, unknown>>);
  if (rows.length === 0) return [];

  // col 위치 → 남은 rowspan 카운트 (다음 행에서 빈 셀로 채워야 함)
  const reserved = new Map<number, number>();
  const expanded: Array<Array<string>> = [];
  let maxCols = 0;

  for (const row of rows) {
    if (!row) {
      expanded.push([]);
      continue;
    }
    const tcs = ensureArray(row.tc as Array<Record<string, unknown>>);
    const cells: Array<string> = [];
    let col = 0;
    let tcIdx = 0;

    while (tcIdx < tcs.length || (reserved.get(col) ?? 0) > 0) {
      const remaining = reserved.get(col) ?? 0;
      if (remaining > 0) {
        cells.push("");
        if (remaining - 1 <= 0) reserved.delete(col);
        else reserved.set(col, remaining - 1);
        col += 1;
        continue;
      }

      const tc = tcs[tcIdx++];
      if (!tc) break;
      const spanNode = tc.cellSpan as Record<string, unknown> | undefined;
      const colSpan = spanNode ? Number(spanNode["@_colSpan"] ?? 1) : 1;
      const rowSpan = spanNode ? Number(spanNode["@_rowSpan"] ?? 1) : 1;
      const text = parseCellText(tc, charStyles, collector);

      cells.push(text);
      col += 1;
      // colSpan-1만큼 빈 셀 padding
      for (let i = 1; i < colSpan; i += 1) {
        cells.push("");
        col += 1;
      }
      // rowSpan>1이면 그 셀이 점유한 모든 col에 잔여 행수 등록
      if (rowSpan > 1) {
        const startCol = col - colSpan;
        for (let c = startCol; c < col; c += 1) {
          reserved.set(c, rowSpan - 1);
        }
      }
    }

    expanded.push(cells);
    maxCols = Math.max(maxCols, cells.length);
  }

  // 모든 행을 maxCols로 padding
  for (const cells of expanded) {
    while (cells.length < maxCols) cells.push("");
  }

  return expanded;
}

function parseTable(
  tbl: Record<string, unknown>,
  charStyles: CharStyles,
  collector: ImageCollector,
): string {
  const grid = expandTableToGrid(tbl, charStyles, collector);
  if (grid.length === 0) return "";

  let html = "<table>\n";
  for (let ri = 0; ri < grid.length; ri += 1) {
    const tag = ri === 0 ? "th" : "td";
    const cells = grid[ri];
    if (!cells) continue;
    html += "<tr>";
    for (const cellText of cells) {
      html += `<${tag}>${cellText}</${tag}>`;
    }
    html += "</tr>\n";
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
