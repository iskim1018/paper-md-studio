import { XMLParser } from "fast-xml-parser";

/**
 * `<hp:t>` 안쪽 혼합 내용의 토큰.
 *
 * OWPML에서 `<hp:t>`는 글자 사이에 빈 요소를 끼워 넣을 수 있다 — 탭, 줄바꿈,
 * 고정폭·묶음 빈칸, 소프트 하이픈, 형광펜·변경 추적 표시. 위치가 의미이므로
 * 글자와 함께 원문 순서대로 토큰화한다.
 */
export type InlineToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "tab"; readonly leader: boolean }
  | { readonly kind: "lineBreak" }
  | { readonly kind: "space" }
  | { readonly kind: "deleteBegin" }
  | { readonly kind: "deleteEnd" };

/** preserveOrder 파싱 결과의 한 노드 — `{ 이름: 자식들, ":@": 속성 }` 또는 `{ "#text": 글 }` */
type OrderedNode = Record<string, unknown>;

/**
 * 안쪽 XML 전용 파서. 순서를 보존하고(preserveOrder) 공백을 깎지 않으며,
 * `&amp;`·`&#x41;` 같은 엔티티와 숫자 문자 참조를 디코딩한다.
 */
const inlineParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: false,
  parseTagValue: false,
  htmlEntities: true,
});

/** 공백으로 바뀌는 빈칸 요소 */
const SPACE_ELEMENTS = new Set(["fwSpace", "nbSpace"]);

/**
 * 글자를 남기지 않는 표시 요소. 형광펜·제목 차례 표시는 서식일 뿐이고,
 * 변경 추적의 삽입 구간은 최종본에 포함되므로 표시만 무시한다.
 * 소프트 하이픈(hyphen)은 줄 끝에서만 보이는 글자라 지운다.
 */
const IGNORED_ELEMENTS = new Set([
  "hyphen",
  "markpenBegin",
  "markpenEnd",
  "titleMark",
  "insertBegin",
  "insertEnd",
]);

const TAG_PATTERN = /<[^>]*>/g;

function isLeaderTab(attrs: unknown): boolean {
  if (typeof attrs !== "object" || attrs === null) return false;
  const leader = (attrs as Record<string, unknown>)["@_leader"];
  if (leader === undefined || leader === null) return false;
  const value = String(leader);
  return value !== "" && value !== "0" && value.toUpperCase() !== "NONE";
}

function elementName(node: OrderedNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@");
}

function tokenOf(name: string, node: OrderedNode): InlineToken | null {
  if (name === "tab") return { kind: "tab", leader: isLeaderTab(node[":@"]) };
  if (name === "lineBreak") return { kind: "lineBreak" };
  if (SPACE_ELEMENTS.has(name)) return { kind: "space" };
  if (name === "deleteBegin") return { kind: "deleteBegin" };
  if (name === "deleteEnd") return { kind: "deleteEnd" };
  return null;
}

function collectTokens(
  nodes: ReadonlyArray<OrderedNode>,
  out: Array<InlineToken>,
): void {
  for (const node of nodes) {
    const name = elementName(node);
    if (name === undefined) continue;
    if (name === "#text") {
      const value = String(node[name] ?? "");
      if (value) out.push({ kind: "text", value });
      continue;
    }
    if (IGNORED_ELEMENTS.has(name)) continue;
    const token = tokenOf(name, node);
    if (token) {
      out.push(token);
      continue;
    }
    // 알 수 없는 요소 — 안에 글자가 있으면 버리지 않는다
    const children = node[name];
    if (Array.isArray(children))
      collectTokens(children as Array<OrderedNode>, out);
  }
}

/**
 * `<hp:t>`의 원문 안쪽 XML을 토큰으로 나눈다.
 *
 * 거의 모든 `<hp:t>`는 순수 텍스트라 `<`·`&`가 없으면 파서를 거치지 않는다
 * (실물 4.5MB 섹션에서 파싱 시간 차이 없음).
 */
export function tokenizeRunText(raw: string): Array<InlineToken> {
  if (!raw) return [];
  if (!raw.includes("<") && !raw.includes("&")) {
    return [{ kind: "text", value: raw }];
  }
  const tokens: Array<InlineToken> = [];
  try {
    const parsed = inlineParser.parse(`<t>${raw}</t>`) as Array<OrderedNode>;
    const root = parsed[0]?.t;
    if (Array.isArray(root)) collectTokens(root as Array<OrderedNode>, tokens);
  } catch {
    // 원문은 이미 섹션 파서를 통과한 XML이라 여기서 실패할 일은 없다.
    // 만에 하나 실패해도 글자는 잃지 않도록 태그만 걷어 낸다.
    const value = raw.replace(TAG_PATTERN, "");
    if (value) tokens.push({ kind: "text", value });
  }
  return tokens;
}
