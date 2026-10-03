import {
  attr,
  childNode,
  childNodes,
  isXmlNode,
  textOf,
  type XmlNode,
} from "./xml.js";

/** 글자 모양 id → 강조 여부 */
export interface CharStyles {
  readonly boldIds: ReadonlySet<string>;
  readonly italicIds: ReadonlySet<string>;
  readonly strikeIds: ReadonlySet<string>;
}

/** numbering > paraHead 한 수준 (level은 1-based) */
export interface ParaHeadDef {
  readonly numFormat: string;
  /** "^1." 같은 형식 문자열. 빈 문자열이면 번호를 붙이지 않는다 */
  readonly format: string;
  readonly start: number;
}

/** numbering 정의 — 수준(1..10) → paraHead */
export type NumberingDef = ReadonlyMap<number, ParaHeadDef>;

/** 문단 모양(paraPr)의 문단 머리 연결 — level은 0-based */
export interface ParaHeadingRef {
  readonly type: "NUMBER" | "BULLET" | "OUTLINE";
  readonly idRef: string;
  readonly level: number;
}

export interface HwpxHeader {
  /** 스타일 id → 이름 */
  readonly styleNames: ReadonlyMap<string, string>;
  readonly charStyles: CharStyles;
  readonly numberings: ReadonlyMap<string, NumberingDef>;
  /** 글머리표 id → 원본 기호 문자 (PUA 정규화 전) */
  readonly bullets: ReadonlyMap<string, string>;
  readonly paraHeadings: ReadonlyMap<string, ParaHeadingRef>;
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

const HEADING_TYPES = new Set(["NUMBER", "BULLET", "OUTLINE"]);
const MAX_HEAD_LEVEL = 10;

export function emptyHeader(): HwpxHeader {
  return {
    styleNames: new Map(),
    charStyles: {
      boldIds: new Set(),
      italicIds: new Set(),
      strikeIds: new Set(),
    },
    numberings: new Map(),
    bullets: new Map(),
    paraHeadings: new Map(),
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

function toInt(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseNumbering(numbering: XmlNode): NumberingDef {
  const heads = new Map<number, ParaHeadDef>();
  for (const head of childNodes(numbering, "paraHead")) {
    const level = toInt(attr(head, "level"), 0);
    if (level < 1 || level > MAX_HEAD_LEVEL) continue;
    heads.set(level, {
      numFormat: attr(head, "numFormat") || "DIGIT",
      format: textOf(head).trim(),
      start: toInt(attr(head, "start"), 1),
    });
  }
  return heads;
}

function parseNumberings(refList: XmlNode): Map<string, NumberingDef> {
  const map = new Map<string, NumberingDef>();
  const container = childNode(refList, "numberings");
  for (const numbering of container ? childNodes(container, "numbering") : []) {
    const id = attr(numbering, "id");
    if (id) map.set(id, parseNumbering(numbering));
  }
  return map;
}

function parseBullets(refList: XmlNode): Map<string, string> {
  const map = new Map<string, string>();
  const container = childNode(refList, "bullets");
  for (const bullet of container ? childNodes(container, "bullet") : []) {
    const id = attr(bullet, "id");
    if (!id) continue;
    // 그림 글머리표는 그릴 수 없으므로 일반 점으로 대신한다
    map.set(id, attr(bullet, "useImage") === "1" ? "•" : attr(bullet, "char"));
  }
  return map;
}

function parseParaHeadings(refList: XmlNode): Map<string, ParaHeadingRef> {
  const map = new Map<string, ParaHeadingRef>();
  const container = childNode(refList, "paraProperties");
  for (const paraPr of container ? childNodes(container, "paraPr") : []) {
    const id = attr(paraPr, "id");
    const heading = childNode(paraPr, "heading");
    if (!id || !heading) continue;
    const type = attr(heading, "type");
    if (!HEADING_TYPES.has(type)) continue;
    map.set(id, {
      type: type as ParaHeadingRef["type"],
      idRef: attr(heading, "idRef"),
      level: Math.min(Math.max(toInt(attr(heading, "level"), 0), 0), 9),
    });
  }
  return map;
}

/** header.xml 파싱 결과에서 스타일·글자 모양·문단 머리 정의를 읽는다 */
export function readHeader(headerDoc: XmlNode): HwpxHeader {
  const head = headerDoc.head;
  const refList = isXmlNode(head) ? childNode(head, "refList") : undefined;
  if (!refList) return emptyHeader();
  return {
    styleNames: parseStyleNames(refList),
    charStyles: parseCharStyles(refList),
    numberings: parseNumberings(refList),
    bullets: parseBullets(refList),
    paraHeadings: parseParaHeadings(refList),
  };
}
