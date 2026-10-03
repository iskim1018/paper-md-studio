import { PIPE_TOKEN } from "../html-tables-to-gfm.js";

/**
 * CommonMark 강조 구분자(`**`·`*`·`~~`)의 flanking 규칙을 지키는 강조 출력.
 *
 * CommonMark 는 여는 구분자 바로 뒤가 문장부호면 바로 앞도 공백·문장부호여야,
 * 닫는 구분자 바로 앞이 문장부호면 바로 뒤도 공백·문장부호여야 강조로 읽는다.
 * 한글 문서에는 `사업` + 굵은 `(SW)` + `정보` 처럼 글자에 붙은 괄호 강조가
 * 흔한데, turndown 은 이를 `사업**(SW)**정보` 로 내어 모든 렌더러(micromark·
 * markdown-it·Milkdown)에서 `**` 가 글자로 보였다 (실물 표본 1006개 중 11개).
 *
 * 그런 경계에서는 가장자리의 문장부호를 구분자 바깥으로 옮긴다 —
 * `사업(**SW**)정보`. 괄호가 굵지 않게 되는 차이만 있고 글자는 그대로이며,
 * 날것 `<strong>` HTML 과 달리 모든 렌더러·편집기에서 진짜 강조로 읽힌다.
 */

/** turndown 이 규칙에 넘기는 DOM 노드 — tsconfig 에 DOM lib 이 없어 필요한 것만 */
export interface DomNode {
  readonly nodeName: string;
  readonly nodeType: number;
  readonly nodeValue: string | null;
  readonly textContent: string | null;
  readonly parentNode: DomNode | null;
  readonly previousSibling: DomNode | null;
  readonly nextSibling: DomNode | null;
}

type CharClass = "space" | "punct" | "word";
type Side = "before" | "after";

const TEXT_NODE = 3;
const CELL_BREAK = "<br>";
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;
/**
 * 바깥 글자를 찾을 때 거슬러 오르는 인라인 부모. 강조끼리는 구분자가 한
 * 덩어리(`***`)가 되므로 부모 강조의 바깥 글자가 곧 이 강조의 바깥 글자다.
 */
const TRANSPARENT_PARENTS = new Set([
  "STRONG",
  "B",
  "EM",
  "I",
  "DEL",
  "S",
  "STRIKE",
  "SPAN",
  "HWPX-MD",
]);
/** Markdown 으로 내려간 뒤 이 요소가 시작·끝나는 글자 */
const ELEMENT_EDGES: Readonly<Record<string, readonly [string, string]>> = {
  BR: ["\n", "\n"],
  IMG: ["!", ")"],
  A: ["[", ")"],
  CODE: ["`", "`"],
  STRONG: ["*", "*"],
  B: ["*", "*"],
  EM: ["*", "*"],
  I: ["*", "*"],
  DEL: ["~", "~"],
  S: ["~", "~"],
  STRIKE: ["~", "~"],
};

function classify(ch: string): CharClass {
  if (!ch || WHITESPACE.test(ch)) return "space";
  if (ch === PIPE_TOKEN || PUNCTUATION.test(ch)) return "punct";
  return "word";
}

function firstChar(text: string): string {
  const cp = text.codePointAt(0);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

function lastChar(text: string): string {
  if (!text) return "";
  const low = text.charCodeAt(text.length - 1);
  const isLowSurrogate = low >= 0xdc00 && low <= 0xdfff;
  return isLowSurrogate && text.length > 1 ? text.slice(-2) : text.slice(-1);
}

function isEmptyText(node: DomNode): boolean {
  return node.nodeType === TEXT_NODE && !node.nodeValue;
}

function edgeChar(node: DomNode, side: Side): string {
  if (node.nodeType !== TEXT_NODE) {
    const edges = ELEMENT_EDGES[node.nodeName];
    if (edges) return side === "after" ? edges[0] : edges[1];
  }
  const text =
    node.nodeType === TEXT_NODE
      ? (node.nodeValue ?? "")
      : (node.textContent ?? "");
  return side === "after" ? firstChar(text) : lastChar(text);
}

function sibling(node: DomNode, side: Side): DomNode | null {
  let next = side === "before" ? node.previousSibling : node.nextSibling;
  while (next && isEmptyText(next)) {
    next = side === "before" ? next.previousSibling : next.nextSibling;
  }
  return next;
}

/** 강조 요소 바깥(앞·뒤)에서 Markdown 으로 맞닿는 글자. 줄 경계면 빈 문자열 */
function outsideChar(node: DomNode, side: Side): string {
  let current = node;
  for (;;) {
    const next = sibling(current, side);
    if (next) return edgeChar(next, side);
    const parent = current.parentNode;
    if (!parent) return "";
    if (parent.nodeName === "A") return side === "before" ? "[" : "]";
    if (!TRANSPARENT_PARENTS.has(parent.nodeName)) return "";
    current = parent;
  }
}

/** Markdown 조각을 escape 쌍(`\X`)은 붙여서 글자 단위로 나눈다 */
function markdownUnits(markdown: string): Array<string> {
  const units: Array<string> = [];
  let i = 0;
  while (i < markdown.length) {
    // 표 셀 안 줄바꿈은 `<br>` 그대로 남는다 — 쪼개면 태그가 깨진다
    if (markdown.startsWith(CELL_BREAK, i)) {
      units.push(CELL_BREAK);
      i += CELL_BREAK.length;
      continue;
    }
    if (markdown[i] === "\\" && i + 1 < markdown.length) {
      const escaped = firstChar(markdown.slice(i + 1, i + 3));
      units.push(`\\${escaped}`);
      i += 1 + escaped.length;
      continue;
    }
    const ch = firstChar(markdown.slice(i, i + 2));
    units.push(ch);
    i += ch.length;
  }
  return units;
}

/**
 * 구분자 바깥으로 옮겨도 되는 글자 — 문장부호(escape 쌍 포함)와 공백.
 * 겹친 강조의 구분자(escape 안 된 `*`·`~`)는 옮기지 않는다.
 */
function isMovable(unit: string): boolean {
  if (unit === CELL_BREAK) return true;
  if (unit === "*" || unit === "~") return false;
  return classify(unit.startsWith("\\") ? "\\" : unit) !== "word";
}

interface Flanking {
  readonly opensBadly: boolean;
  readonly closesBadly: boolean;
}

function flankingOf(node: DomNode): Flanking {
  const text = node.textContent ?? "";
  const inner = text.trim();
  const before = /^\s/u.test(text) ? " " : outsideChar(node, "before");
  const after = /\s$/u.test(text) ? " " : outsideChar(node, "after");
  return {
    opensBadly:
      classify(firstChar(inner)) === "punct" && classify(before) === "word",
    closesBadly:
      classify(lastChar(inner)) === "punct" && classify(after) === "word",
  };
}

/**
 * turndown 강조 규칙의 replacement. `content` 는 이미 Markdown 으로 바뀐
 * 안쪽, `node` 는 강조 요소다.
 */
export function wrapEmphasis(
  content: string,
  node: DomNode,
  delimiter: string,
): string {
  if (!content.trim()) return "";
  const { opensBadly, closesBadly } = flankingOf(node);
  if (!opensBadly && !closesBadly) return `${delimiter}${content}${delimiter}`;

  const units = markdownUnits(content);
  let start = 0;
  let end = units.length;
  if (opensBadly) {
    while (start < end && isMovable(units[start] ?? "")) start += 1;
  }
  if (closesBadly) {
    while (end > start && isMovable(units[end - 1] ?? "")) end -= 1;
  }
  const lead = units.slice(0, start).join("");
  const core = units.slice(start, end).join("");
  const trail = units.slice(end).join("");
  // 문장부호뿐인 강조 — 강조를 버리고 글자만 남긴다 (`가**()**나` → `가()나`)
  if (!core.trim()) return `${lead}${core}${trail}`;
  return `${lead}${delimiter}${core}${delimiter}${trail}`;
}
