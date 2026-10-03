import { XMLParser } from "fast-xml-parser";

/** fast-xml-parser가 만든 요소 노드 (속성은 `@_` 접두사, 텍스트는 `#text`) */
export type XmlNode = Record<string, unknown>;

/** 순서를 복원한 자식 요소 */
export interface XmlChild {
  readonly name: string;
  readonly node: XmlNode;
}

/**
 * 섹션(본문) XML 파서.
 *
 * fast-xml-parser 기본값은 HWPX 본문을 세 군데서 망가뜨렸다.
 * - `trimValues`: 텍스트 조각마다 앞뒤 공백을 깎아 run 경계의 띄어쓰기가
 *   사라졌다 (`제21조와 ` + `같은` → `제21조와같은`). 공백만 있는 `<hp:t> </hp:t>`는
 *   통째로 사라졌다.
 * - `parseTagValue`: 숫자처럼 보이는 텍스트를 숫자로 바꿨다 (`1.0`→`1`,
 *   `007`→`7`). 0.7.0에서 XLSX를 고친 것과 같은 원인이다 (`xlsx/workbook.ts`).
 * - 혼합 내용(`글<hp:tab/>글`)의 텍스트를 하나로 이어 붙이고 자식 위치를 버려
 *   탭·줄바꿈 자리가 사라졌다.
 *
 * 그래서 `<hp:t>`는 stopNode로 두어 안쪽 XML을 원문 그대로(공백·순서 보존)
 * 받고 `tokenizeRunText`가 따로 해석한다. `captureMetaData`는 요소마다 원문
 * 시작 위치를 남겨, 이름별로 묶인 자식들(t·tbl·pic·ctrl…)의 문서 순서를
 * 되살리는 데 쓴다. `alwaysCreateTextNode`는 `<hp:t>`가 늘 객체가 되어 위치
 * 정보를 달 수 있게 한다.
 */
const sectionParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  htmlEntities: true,
  stopNodes: ["*.t"],
  alwaysCreateTextNode: true,
  captureMetaData: true,
});

/**
 * header.xml·content.hpf 파서. 속성과 구조만 읽으므로 공백 처리는 기본값을
 * 두되, 문단 번호 형식(`<hh:paraHead>^1.</hh:paraHead>`) 같은 텍스트가 숫자로
 * 바뀌지 않게 `parseTagValue`만 끈다.
 */
const headerParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
});

/**
 * 요소의 원문 위치 정보 키. 타입 선언은 래퍼 `Symbol`이지만 실제로는 symbol
 * 원시값이다 (Symbol이 없는 환경이면 일반 문자열 속성).
 */
const META = XMLParser.getMetaDataSymbol() as unknown as symbol | string;

export function parseSectionXml(xml: string): XmlNode {
  return sectionParser.parse(xml) as XmlNode;
}

export function parseHeaderXml(xml: string): XmlNode {
  return headerParser.parse(xml) as XmlNode;
}

export function ensureArray<T>(
  value: T | Array<T> | undefined | null,
): Array<T> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 자식 요소 목록 (없거나 문자열 같은 빈 요소면 빈 배열) */
export function childNodes(node: XmlNode, name: string): Array<XmlNode> {
  return ensureArray(node[name]).filter(isXmlNode);
}

/** 첫 자식 요소 */
export function childNode(node: XmlNode, name: string): XmlNode | undefined {
  return childNodes(node, name)[0];
}

/** 속성값 (없으면 빈 문자열) */
export function attr(node: XmlNode, name: string): string {
  const value = node[`@_${name}`];
  return value === undefined || value === null ? "" : String(value);
}

/** 요소의 텍스트 (`#text`) */
export function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (!isXmlNode(node)) return "";
  const text = node["#text"];
  return text === undefined || text === null ? "" : String(text);
}

function startIndexOf(node: XmlNode): number {
  const meta = (node as Record<symbol | string, unknown>)[META];
  if (!isXmlNode(meta)) return Number.MAX_SAFE_INTEGER;
  const index = meta.startIndex;
  return typeof index === "number" ? index : Number.MAX_SAFE_INTEGER;
}

/**
 * 자식 요소들을 원문 순서대로 돌려준다.
 *
 * fast-xml-parser는 같은 이름의 자식을 한 배열로 묶어, `<t>글</t><tbl/><t>글</t>`의
 * 순서가 `{t:[…], tbl:[…]}`로 흩어진다. 요소마다 남긴 시작 위치로 다시 줄 세운다.
 * 내용 없는 빈 요소(문자열로 파싱됨)는 위치를 알 수 없고 담긴 것도 없어 뺀다.
 */
export function orderedChildren(node: XmlNode): Array<XmlChild> {
  const children: Array<XmlChild & { readonly index: number }> = [];
  for (const [name, value] of Object.entries(node)) {
    if (name.startsWith("@_") || name === "#text") continue;
    for (const child of ensureArray(value)) {
      if (isXmlNode(child)) {
        children.push({ name, node: child, index: startIndexOf(child) });
      }
    }
  }
  return children
    .sort((a, b) => a.index - b.index)
    .map(({ name, node: child }) => ({ name, node: child }));
}
