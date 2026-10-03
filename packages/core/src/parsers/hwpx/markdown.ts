import { randomBytes } from "node:crypto";
import type TurndownService from "turndown";
import { createTurndownService } from "../../html-to-md.js";
import { type DomNode, wrapEmphasis } from "./emphasis.js";

/**
 * HWPX 전용 turndown 서비스.
 *
 * HWPX 파서는 escape 하면 안 되는 조각(문단 머리 번호·글머리표, 수식 LaTeX)을
 * 전용 요소 `<hwpx-md>`로 감싸 넘긴다. 이 규칙이 모든 포맷이 쓰는 공유
 * 서비스에 있으면 HTML 문서가 같은 태그로 날것 Markdown(`[c](javascript:…)`)을
 * 끼워 넣을 수 있었다. 그래서
 * - 규칙은 이 서비스에만 둔다 (HTML·DOCX 경로는 `htmlToMarkdown`).
 * - 프로세스마다 새로 뽑는 표지(nonce)가 맞는 요소만 날것으로 낸다 — HWPX
 *   HTML 에 끼어들 틈(예: escape 안 된 속성)이 생겨도 표지를 모르면 못 쓴다.
 * - 뷰어용 HTML 에서는 `stripRawMarkers`로 요소째 걷어 표지가 새지 않게 한다.
 */

const RAW_TAG = "hwpx-md";
const NONCE = randomBytes(12).toString("hex");
/** 날것 Markdown — textContent 를 그대로 낸다 */
const RAW_ATTR = "data-raw";
/** 줄 머리 — turndown 이 놓치는 블록 문법(`1)`, 홀로 선 `2024.`·`#`·`+`)을 막는다 */
const LEAD_ATTR = "data-lead";

const MARKER_PATTERN = new RegExp(
  `<${RAW_TAG} (?:${RAW_ATTR}|${LEAD_ATTR})="${NONCE}">|</${RAW_TAG}>`,
  "g",
);
const ORDERED_LIST_START = /^(\d{1,9})([.)])(?=\s|$)/;
const BULLET_OR_HEADING_START = /^([-+*]|#{1,6})(?=\s|$)/;

type ElementLike = DomNode & {
  getAttribute(name: string): string | null;
};

let service: TurndownService | null = null;

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Markdown 조각을 turndown 이 escape 하지 않고 그대로 내보낼 HTML로 감싼다 */
export function rawMarkdownHtml(markdown: string): string {
  return `<${RAW_TAG} ${RAW_ATTR}="${NONCE}">${escapeHtmlText(markdown)}</${RAW_TAG}>`;
}

/**
 * 줄 머리에 놓일 인라인 HTML을 감싼다. 목록 머리(`1. `·`- `) 바로 뒤나 번호를
 * escape 한 문단처럼, 글자가 줄 맨 앞에 오는데 turndown 의 기본 escape 가
 * 막지 못하는 블록 문법(`1) 하위`, 홀로 선 `2024.`)을 escape 한다.
 */
export function leadingBlockSafeHtml(html: string): string {
  return `<${RAW_TAG} ${LEAD_ATTR}="${NONCE}">${html}</${RAW_TAG}>`;
}

/** 뷰어용 HTML 에서 전용 요소를 걷어낸다 (글자는 남는다) */
export function stripRawMarkers(html: string): string {
  return html.replace(MARKER_PATTERN, "");
}

function hasMarker(node: unknown, attribute: string): boolean {
  const el = node as ElementLike;
  return (
    el.nodeName === RAW_TAG.toUpperCase() &&
    typeof el.getAttribute === "function" &&
    el.getAttribute(attribute) === NONCE
  );
}

function escapeLeadingBlock(markdown: string): string {
  return markdown
    .replace(ORDERED_LIST_START, "$1\\$2")
    .replace(BULLET_OR_HEADING_START, "\\$1");
}

function addRules(target: TurndownService): void {
  target.addRule("hwpxRawMarkdown", {
    filter: (node) => hasMarker(node, RAW_ATTR),
    replacement: (_content, node) =>
      (node as unknown as DomNode).textContent ?? "",
  });
  target.addRule("hwpxLeadingBlock", {
    filter: (node) => hasMarker(node, LEAD_ATTR),
    replacement: (content) => escapeLeadingBlock(content),
  });
  const emphasis = (
    name: string,
    tags: Array<"strong" | "b" | "em" | "i" | "del" | "s" | "strike">,
    delimiter: string,
  ): void => {
    target.addRule(name, {
      filter: tags,
      replacement: (content, node) =>
        wrapEmphasis(content, node as unknown as DomNode, delimiter),
    });
  };
  emphasis("hwpxStrong", ["strong", "b"], "**");
  emphasis("hwpxEmphasis", ["em", "i"], "*");
  emphasis("hwpxStrikethrough", ["del", "s", "strike"], "~~");
}

function buildService(): TurndownService {
  const created = createTurndownService();
  addRules(created);
  // 본문의 "$"를 escape 한다 — 수식이 `$…$`로 나가므로, 앱 편집기(remark-math)는
  // 본문 "US$5"의 "$"를 수식 경계로 읽어 수식을 깨뜨린다. 수식이 없는 문서도
  // "$"가 두 개면 그 사이가 수식이 된다. `\$`는 CommonMark 의 정식 escape 라
  // 일반 렌더러에서도 "$"로 보이고, 실물 표본에 본문 "$"가 0개라 비용도 없다.
  const baseEscape = created.escape.bind(created);
  created.escape = (text: string): string =>
    baseEscape(text).replace(/\$/g, "\\$");
  return created;
}

function getService(): TurndownService {
  if (!service) service = buildService();
  return service;
}

/** HWPX 파서가 만든 HTML 을 Markdown 으로 내린다 (한 번에 — 테스트·작은 조각용) */
export function hwpxHtmlToMarkdown(html: string): string {
  return getService().turndown(html);
}

/**
 * turndown 한 번에 넘기는 최상위 블록 수. turndown 은 입력 전체를 DOM 으로
 * 만들므로, 문서 전체를 한 번에 넘기면 본문 XML 16MB(문단 64만 개)에 DOM 만
 * 750MB 를 썼다. 묶음 하나의 DOM 은 이 블록 수에 비례하는 만큼만 남는다.
 */
export const MAX_BLOCKS_PER_TURNDOWN = 2000;

/**
 * 묶음 앞뒤에 세우는 경계 문단. 글자는 escape 대상이 없는 영숫자라 그대로
 * 나온다.
 *
 * 묶음마다 turndown 을 따로 부르면 출력 앞뒤 공백을 깎는 후처리가 묶음마다
 * 돌아, 문서 전체를 한 번에 변환한 것과 달라진다 (문단 끝 `<br>`의 `"  "`,
 * 날것 Markdown 첫머리의 탭). 경계 문단 사이에 끼우면 깎이는 것은 경계
 * 문단의 바깥뿐이다. 블록 문단의 출력은 앞뒤에 빈 줄을 두므로 경계 문단과
 * 블록 사이는 언제나 정확히 빈 줄 하나("\n\n")다 — 블록끼리 사이와 같다.
 * 공백 접기(collapseWhitespace)도 블록 요소에서 상태를 비우므로, 다음 묶음의
 * 첫 블록과 경계 문단 뒤의 상태가 같다.
 */
const CHUNK_BOUNDARY = `hwpxchunk${NONCE}`;
const BOUNDARY_BLOCK = `<p>${CHUNK_BOUNDARY}</p>`;
const CHUNK_HEAD = `${CHUNK_BOUNDARY}\n\n`;
const CHUNK_TAIL = `\n\n${CHUNK_BOUNDARY}`;
const EMPTY_CHUNK = `${CHUNK_BOUNDARY}\n\n${CHUNK_BOUNDARY}`;

/** 묶음 하나를 변환해 경계 문단을 걷어낸다 — 내용이 없으면 "" */
function convertChunk(blocks: ReadonlyArray<string>): string {
  const markdown = getService().turndown(
    `${BOUNDARY_BLOCK}${blocks.join("")}${BOUNDARY_BLOCK}`,
  );
  if (markdown === EMPTY_CHUNK) return "";
  if (!markdown.startsWith(CHUNK_HEAD) || !markdown.endsWith(CHUNK_TAIL)) {
    throw new Error(
      "HWPX 본문을 Markdown 으로 나눠 변환하다 묶음 경계를 잃었습니다 (내부 오류).",
    );
  }
  return markdown.slice(CHUNK_HEAD.length, -CHUNK_TAIL.length);
}

/**
 * 최상위 블록(문단·제목·목록·표 HTML) 목록을 묶음 단위로 Markdown 으로
 * 내린다. 결과는 블록을 모두 이어 `hwpxHtmlToMarkdown` 한 번에 넘긴 것과
 * 같다 — 묶음 사이는 블록 사이와 같은 빈 줄로 잇고, 문서 앞뒤 공백은 turndown
 * 후처리와 같은 규칙으로 깎는다.
 */
export function hwpxBlocksToMarkdown(
  blocks: ReadonlyArray<string>,
  chunkSize: number = MAX_BLOCKS_PER_TURNDOWN,
): string {
  const parts: Array<string> = [];
  for (let start = 0; start < blocks.length; start += chunkSize) {
    const markdown = convertChunk(blocks.slice(start, start + chunkSize));
    if (markdown) parts.push(markdown);
  }
  return parts
    .join("\n\n")
    .replace(/^[\t\r\n]+/, "")
    .replace(/[\t\r\n\s]+$/, "");
}
