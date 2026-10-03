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

export interface TableCaption {
  /** 표 앞(위·왼쪽)에 놓이는지 */
  readonly before: boolean;
  readonly paragraphs: ReadonlyArray<XmlNode>;
}

/** 표 캡션 — side가 TOP/LEFT면 표 앞, BOTTOM/RIGHT면 표 뒤 */
export function tableCaption(tbl: XmlNode): TableCaption | null {
  const caption = childNode(tbl, "caption");
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

/** http(s)·mailto 주소만 통과시킨다. "|"는 표 셀을 깨므로 인코딩한다 */
export function sanitizeLinkUrl(raw: string): string | null {
  // 한컴이 스킴을 두 번 저장하는 경우 ("http://https://…")
  const url = raw.replace(/^https?:\/\/(?=https?:\/\/)/i, "");
  try {
    if (!SAFE_PROTOCOLS.has(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  return url.replace(/\|/g, "%7C").replace(/\s/g, "%20");
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
