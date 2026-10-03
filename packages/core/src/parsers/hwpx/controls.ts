import { formatHeadNumber } from "./numbering.js";
import { attr, childNode, childNodes, textOf, type XmlNode } from "./xml.js";

/**
 * 문단 안 개체·조판 부호에서 내용을 꺼내는 순수 함수 모음.
 * 어떻게 그릴지는 호출측(문단 walker·표·본문)이 정한다.
 */

/**
 * 글상자 등 그리기 개체 — `<hp:drawText><hp:subList><hp:p>`로 글을 담는다.
 * 종전 파서는 이 글을 통째로 버렸다 (실물 표본에서 글상자 1개, 166자).
 */
export const DRAWING_OBJECTS: ReadonlySet<string> = new Set([
  "rect",
  "ellipse",
  "polygon",
  "arc",
  "curve",
  "connectLine",
  "line",
]);

/**
 * 본문에 쓰는 자동 번호 종류 — 캡션의 표·그림·수식 번호. 쪽 번호는 Markdown 에
 * 쪽이 없어 의미가 없고, 각주·미주 번호는 "(각주: …)"로 이미 자리를 표시한다.
 */
const CAPTION_NUMBER_TYPES = new Set(["TABLE", "PICTURE", "EQUATION"]);

/** 종류별 다음 번호 — 저장된 번호가 있으면 그것을 쓴다 */
export type AutoNumberCounter = (type: string, stored: number | null) => number;

/**
 * `<hp:autoNum>`(한글 "캡션 넣기"가 쓰는 번호)을 글자로 쓴다. 서식(autoNumFormat
 * type)과 앞뒤 문자(prefixChar·suffixChar)를 따른다. 본문에 쓰지 않는 종류면 null.
 */
export function autoNumberText(
  node: XmlNode,
  next: AutoNumberCounter,
): string | null {
  const type = attr(node, "numType").toUpperCase();
  if (!CAPTION_NUMBER_TYPES.has(type)) return null;
  const stored = Number.parseInt(attr(node, "num"), 10);
  const value = next(
    type,
    Number.isFinite(stored) && stored > 0 ? stored : null,
  );
  const format = childNode(node, "autoNumFormat");
  const numFormat = (format && attr(format, "type")) || "DIGIT";
  const prefix = format ? attr(format, "prefixChar") : "";
  const suffix = format ? attr(format, "suffixChar") : "";
  return `${prefix}${formatHeadNumber(value, numFormat)}${suffix}`;
}

/** 링크로 내보내도 되는 주소 형식 — 그 밖(javascript: 등)은 글자만 남긴다 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** subList 안의 문단들 */
export function subListParagraphs(node: XmlNode): Array<XmlNode> {
  return childNodes(node, "subList").flatMap((list) => childNodes(list, "p"));
}

/** 그리기 개체의 글상자 문단 (없으면 빈 배열) */
export function drawTextParagraphs(shape: XmlNode): Array<XmlNode> {
  const drawText = childNode(shape, "drawText");
  return drawText ? subListParagraphs(drawText) : [];
}

export interface Caption {
  /** 개체 앞(위·왼쪽)에 놓이는지 */
  readonly before: boolean;
  readonly paragraphs: ReadonlyArray<XmlNode>;
}

/**
 * 개체 캡션 — side가 TOP/LEFT면 개체 앞, BOTTOM/RIGHT면 개체 뒤.
 *
 * OWPML 에서 캡션은 표만이 아니라 모든 개체(그림·그리기 개체·수식·묶음
 * 개체)가 가질 수 있다 (AbstractShapeObjectType). 종전엔 표만 읽어
 * 보고서에 흔한 "그림 1. …" 캡션이 조용히 사라졌다.
 */
export function captionOf(node: XmlNode): Caption | null {
  const caption = childNode(node, "caption");
  if (!caption) return null;
  const side = attr(caption, "side").toUpperCase();
  const paragraphs = subListParagraphs(caption);
  if (paragraphs.length === 0) return null;
  return { before: side !== "BOTTOM" && side !== "RIGHT", paragraphs };
}

/**
 * 한글이 하이퍼링크 명령에 쓰는 escape를 풀고 첫 `;` 앞까지를 주소로 본다.
 * 저장 형태: `https\://example.com/a;1;0;0;` (`\:`·`\;`·`\\` escape, 뒤는 옵션)
 */
function decodeHyperlinkCommand(command: string): string {
  let out = "";
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === "\\" && i + 1 < command.length) {
      out += command[i + 1];
      i += 1;
      continue;
    }
    if (ch === ";") break;
    out += ch;
  }
  return out.trim();
}

/**
 * http(s)·mailto 주소만 통과시킨다.
 *
 * - `|`는 표 셀을 깨므로, 공백은 링크 문법을 끊으므로 인코딩한다.
 * - 백슬래시는 Markdown 에서 다음 글자를 escape 한다. turndown 은 주소 안의
 *   `()<>`만 escape 하므로 `\)`가 링크를 일찍 닫고 뒤에 `javascript:` 자동
 *   링크를 이을 수 있었다. http(s) 는 브라우저(WHATWG)가 경로의 `\`를 `/`로
 *   읽으므로 그 해석(`URL.href`)을 그대로 쓰고, 남는 `\`(쿼리 등)는 `%5C`로
 *   인코딩한다. 백슬래시가 없는 주소는 손대지 않는다 — href 로 정규화하면
 *   한글 경로가 %XX 로 9배 길어지고 끝에 `/`가 붙는 등 출력이 흔들린다.
 */
export function sanitizeLinkUrl(raw: string): string | null {
  // 한컴이 스킴을 두 번 저장하는 경우 ("http://https://…")
  const url = raw.replace(/^https?:\/\/(?=https?:\/\/)/i, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
  const normalized =
    url.includes("\\") && parsed.protocol !== "mailto:" ? parsed.href : url;
  return normalized
    .replace(/\\/g, "%5C")
    .replace(/\|/g, "%7C")
    .replace(/\s/g, "%20");
}

/**
 * `<hp:fieldBegin type="HYPERLINK">`의 주소. 하이퍼링크가 아니거나 안전하지
 * 않은 주소면 null.
 */
export function hyperlinkUrl(fieldBegin: XmlNode): string | null {
  if (attr(fieldBegin, "type").toUpperCase() !== "HYPERLINK") return null;
  const params = childNodes(fieldBegin, "parameters").flatMap((p) =>
    childNodes(p, "stringParam"),
  );
  const paramText = (name: string): string => {
    const param = params.find((p) => attr(p, "name") === name);
    return param ? textOf(param).trim() : "";
  };
  // Path는 주소 그대로, Command는 escape + 뒤따르는 옵션(";1;0;0;")이 붙은 형태다
  const url = paramText("Path") || decodeHyperlinkCommand(paramText("Command"));
  return url ? sanitizeLinkUrl(url) : null;
}
