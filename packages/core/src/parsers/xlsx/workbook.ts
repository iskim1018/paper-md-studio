import { XMLParser } from "fast-xml-parser";

/** 워크북(xl/workbook.xml)·공유 문자열·관계(.rels) 파싱 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (tagName) =>
    ["sheet", "Relationship", "si", "r", "t"].includes(tagName),
});

function toArray<T>(value: T | Array<T> | undefined): Array<T> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("#text" in record) return String(record["#text"] ?? "");
    return "";
  }
  return String(node);
}

export interface SheetRef {
  readonly name: string;
  readonly relId: string;
  /** 숨김·매우숨김 시트 여부 (state="hidden" | "veryHidden") */
  readonly hidden: boolean;
}

export interface WorkbookInfo {
  readonly sheets: ReadonlyArray<SheetRef>;
  /** 1904 날짜 체계 사용 여부 (구 맥 엑셀) */
  readonly date1904: boolean;
}

export function parseWorkbook(xml: string): WorkbookInfo {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const workbook = (doc.workbook ?? {}) as Record<string, unknown>;
  const sheetsNode = (workbook.sheets ?? {}) as Record<string, unknown>;
  const pr = (workbook.workbookPr ?? {}) as Record<string, unknown>;
  const date1904Attr = String(pr["@_date1904"] ?? "");

  const sheets = toArray(
    sheetsNode.sheet as Array<Record<string, unknown>> | undefined,
  ).map((sheet) => {
    const state = String(sheet["@_state"] ?? "").toLowerCase();
    return {
      name: String(sheet["@_name"] ?? ""),
      relId: String(sheet["@_id"] ?? ""),
      hidden: state === "hidden" || state === "veryhidden",
    };
  });

  return {
    sheets,
    date1904: date1904Attr === "1" || date1904Attr === "true",
  };
}

/** 관계 파일(.rels)에서 관계 ID → 대상 경로 맵을 만든다 */
export function parseRelationships(xml: string): Map<string, string> {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc.Relationships ?? {}) as Record<string, unknown>;
  const map = new Map<string, string>();

  for (const rel of toArray(
    root.Relationship as Array<Record<string, unknown>> | undefined,
  )) {
    const id = String(rel["@_Id"] ?? "");
    const target = String(rel["@_Target"] ?? "");
    if (id) map.set(id, target);
  }
  return map;
}

/** 공유 문자열 테이블(xl/sharedStrings.xml) */
export function parseSharedStrings(xml: string): Array<string> {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const sst = (doc.sst ?? {}) as Record<string, unknown>;

  return toArray(sst.si as Array<Record<string, unknown>> | undefined).map(
    (item) => {
      const runs = toArray(
        item.r as Array<Record<string, unknown>> | undefined,
      );
      if (runs.length > 0) {
        return runs.map((run) => toArray(run.t).map(textOf).join("")).join("");
      }
      return toArray(item.t).map(textOf).join("");
    },
  );
}

/**
 * zip 내부 상대 경로를 정규화한다.
 * 관계의 Target은 자기 파트 기준 상대경로(`../media/image1.png`)로 적힌다.
 */
export function resolveZipPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = `${baseDir}/${target}`.split("/");
  const stack: Array<string> = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.join("/");
}
