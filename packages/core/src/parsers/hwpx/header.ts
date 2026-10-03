import { attr, childNode, childNodes, isXmlNode, type XmlNode } from "./xml.js";

/** 글자 모양 id → 강조 여부 */
export interface CharStyles {
  readonly boldIds: ReadonlySet<string>;
  readonly italicIds: ReadonlySet<string>;
  readonly strikeIds: ReadonlySet<string>;
}

export interface HwpxHeader {
  /** 스타일 id → 이름 */
  readonly styleNames: ReadonlyMap<string, string>;
  readonly charStyles: CharStyles;
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

export function emptyHeader(): HwpxHeader {
  return {
    styleNames: new Map(),
    charStyles: {
      boldIds: new Set(),
      italicIds: new Set(),
      strikeIds: new Set(),
    },
  };
}

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

function parseStyleNames(refList: XmlNode): Map<string, string> {
  const map = new Map<string, string>();
  const styles = childNode(refList, "styles");
  for (const style of styles ? childNodes(styles, "style") : []) {
    const id = attr(style, "id");
    if (id) map.set(id, attr(style, "name"));
  }
  return map;
}

function parseCharStyles(refList: XmlNode): CharStyles {
  const boldIds = new Set<string>();
  const italicIds = new Set<string>();
  const strikeIds = new Set<string>();
  const props = childNode(refList, "charProperties");
  for (const cp of props ? childNodes(props, "charPr") : []) {
    const id = attr(cp, "id");
    // <bold/>, <italic/>는 빈 element를 on 마커로만 사용 (parsed as "")
    if (cp.bold !== undefined) boldIds.add(id);
    if (cp.italic !== undefined) italicIds.add(id);
    // 실제 한컴 HWPX는 모든 charPr이 <strikeout shape="..."/>를 포함한다.
    if (isStrikeEnabled(cp.strikeout)) strikeIds.add(id);
  }
  return { boldIds, italicIds, strikeIds };
}

/** header.xml 파싱 결과에서 스타일·글자 모양 정의를 읽는다 */
export function readHeader(headerDoc: XmlNode): HwpxHeader {
  const head = headerDoc.head;
  const refList = isXmlNode(head) ? childNode(head, "refList") : undefined;
  if (!refList) return emptyHeader();
  return {
    styleNames: parseStyleNames(refList),
    charStyles: parseCharStyles(refList),
  };
}
