/**
 * HWPX 문서 전체 텍스트 인덱스.
 *
 * rhwp의 `searchText`는 본문 문단만 검색하고 표 셀·중첩 표 셀로는 내려가지
 * 않는다. 표가 대부분인 문서(요구사항 정의서 등)는 사실상 검색이 0건이 된다.
 *
 * 이 모듈은 문서 트리(본문 문단 + 표 셀 + 중첩 표 셀)를 직접 순회해
 * `TextSegment` 목록을 만들고, JS 측에서 부분 문자열 매칭을 수행한다.
 * 매치 좌표 변환(rect)은 `use-hwpx-search`가 담당한다.
 */

import type { HwpDocument } from "./rhwp";

/** 표 셀로 한 단계 내려가는 경로 요소. 중첩되면 여러 개가 쌓인다. */
export interface CellPathEntry {
  readonly controlIndex: number;
  readonly cellIndex: number;
  readonly cellParaIndex: number;
}

/** 텍스트 세그먼트의 위치. 본문 문단 또는 (중첩) 표 셀 문단. */
export type SegmentLocator =
  | { readonly kind: "body"; readonly sec: number; readonly para: number }
  | {
      readonly kind: "cell";
      readonly sec: number;
      readonly parentPara: number;
      readonly path: ReadonlyArray<CellPathEntry>;
    };

/** 한 문단(본문 또는 셀) = 텍스트 한 덩어리. */
export interface TextSegment {
  readonly locator: SegmentLocator;
  readonly text: string;
}

/** 세그먼트 안에서 발견된 쿼리 매치 하나. */
export interface SegmentMatch {
  readonly locator: SegmentLocator;
  readonly charOffset: number;
  readonly length: number;
}

/** 중첩 표 순회 최대 깊이 (html-to-md 변환과 동일 정책). */
const MAX_DEPTH = 5;
/** 셀 문단 내부에서 중첩 표(컨트롤)를 탐색할 최대 인덱스. */
const MAX_CELL_CONTROLS = 4;
/** 매치 폭주 방지 상한. */
const MAX_MATCHES = 2000;

/** rhwp 호출이 던지거나 0/빈 값을 줄 수 있어 안전 래퍼로 감싼다. */
function safeNumber(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}

function safeString(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** `getTableDimensions*` 응답이 표인지 검증하고 cellCount를 반환한다. */
function tableCellCount(raw: string | null): number | null {
  const parsed = parseJson(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const cellCount = (parsed as Record<string, unknown>).cellCount;
  return typeof cellCount === "number" ? cellCount : null;
}

/** path의 마지막 요소만 교체한 새 배열을 반환한다 (불변). */
function withLastEntry(
  path: ReadonlyArray<CellPathEntry>,
  entry: CellPathEntry,
): Array<CellPathEntry> {
  return [...path.slice(0, -1), entry];
}

/** path가 가리키는 표의 cellCount. 표가 아니면 null. */
function probeTable(
  doc: HwpDocument,
  sec: number,
  parentPara: number,
  path: ReadonlyArray<CellPathEntry>,
): number | null {
  return tableCellCount(
    safeString(() =>
      doc.getTableDimensionsByPath(sec, parentPara, JSON.stringify(path)),
    ),
  );
}

/** 본문 문단의 컨트롤 개수. */
function controlCount(doc: HwpDocument, sec: number, para: number): number {
  const positions = parseJson(
    safeString(() => doc.getControlTextPositions(sec, para)),
  );
  return Array.isArray(positions) ? positions.length : 0;
}

/**
 * 순회 작업 단위. 재귀 대신 명시적 스택으로 관리해 임의의 지점에서 중단·재개
 * 할 수 있게 한다 (대용량 문서에서 메인 스레드를 통째로 점유하지 않기 위함).
 * 스택은 LIFO이므로 자식 작업을 역순으로 push하면 문서 순서가 보존된다.
 */
type WorkItem =
  | { readonly kind: "bodyPara"; readonly sec: number; readonly para: number }
  | {
      readonly kind: "table";
      readonly sec: number;
      readonly parentPara: number;
      readonly tablePath: ReadonlyArray<CellPathEntry>;
      readonly cellCount: number;
      readonly depth: number;
    }
  | {
      readonly kind: "cell";
      readonly sec: number;
      readonly parentPara: number;
      readonly tablePath: ReadonlyArray<CellPathEntry>;
      readonly cellIndex: number;
      readonly depth: number;
    }
  | {
      readonly kind: "cellPara";
      readonly sec: number;
      readonly parentPara: number;
      readonly path: ReadonlyArray<CellPathEntry>;
      readonly depth: number;
    };

/** 자식 작업들을 문서 순서대로 실행되도록 스택에 역순 push. */
function pushChildren(
  stack: Array<WorkItem>,
  children: ReadonlyArray<WorkItem>,
): void {
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i];
    if (child) stack.push(child);
  }
}

/** 문단(본문 또는 셀) 안의 표 컨트롤을 탐색해 table 작업으로 만든다. */
function tableChildren(
  doc: HwpDocument,
  sec: number,
  parentPara: number,
  basePath: ReadonlyArray<CellPathEntry>,
  controlLimit: number,
  depth: number,
): Array<WorkItem> {
  if (depth > MAX_DEPTH) return [];
  const children: Array<WorkItem> = [];
  for (let ctrl = 0; ctrl < controlLimit; ctrl += 1) {
    const tablePath: Array<CellPathEntry> = [
      ...basePath,
      { controlIndex: ctrl, cellIndex: 0, cellParaIndex: 0 },
    ];
    const cellCount = probeTable(doc, sec, parentPara, tablePath);
    if (cellCount === null) continue;
    children.push({
      kind: "table",
      sec,
      parentPara,
      tablePath,
      cellCount,
      depth,
    });
  }
  return children;
}

/** 본문 문단 하나: 본문 텍스트 수집 + 문단 내 표를 자식 작업으로 반환. */
function expandBodyPara(
  doc: HwpDocument,
  item: Extract<WorkItem, { kind: "bodyPara" }>,
  out: Array<TextSegment>,
): Array<WorkItem> {
  const { sec, para } = item;
  const bodyLen = safeNumber(() => doc.getParagraphLength(sec, para));
  if (bodyLen > 0) {
    const text = safeString(() => doc.getTextRange(sec, para, 0, bodyLen));
    if (text !== null && text.length > 0) {
      out.push({ locator: { kind: "body", sec, para }, text });
    }
  }
  return tableChildren(doc, sec, para, [], controlCount(doc, sec, para), 1);
}

/** 표 하나: 셀 작업으로 펼친다. */
function expandTable(
  item: Extract<WorkItem, { kind: "table" }>,
): Array<WorkItem> {
  const { sec, parentPara, tablePath, cellCount, depth } = item;
  const children: Array<WorkItem> = [];
  for (let cell = 0; cell < cellCount; cell += 1) {
    children.push({
      kind: "cell",
      sec,
      parentPara,
      tablePath,
      cellIndex: cell,
      depth,
    });
  }
  return children;
}

/** 셀 하나: 셀 문단 작업으로 펼친다. */
function expandCell(
  doc: HwpDocument,
  item: Extract<WorkItem, { kind: "cell" }>,
): Array<WorkItem> {
  const { sec, parentPara, tablePath, cellIndex, depth } = item;
  const lastEntry = tablePath[tablePath.length - 1];
  if (!lastEntry) return [];
  const controlIndex = lastEntry.controlIndex;

  const firstParaPath = withLastEntry(tablePath, {
    controlIndex,
    cellIndex,
    cellParaIndex: 0,
  });
  const cpCount = safeNumber(() =>
    doc.getCellParagraphCountByPath(
      sec,
      parentPara,
      JSON.stringify(firstParaPath),
    ),
  );

  const children: Array<WorkItem> = [];
  for (let cp = 0; cp < cpCount; cp += 1) {
    children.push({
      kind: "cellPara",
      sec,
      parentPara,
      path: withLastEntry(tablePath, {
        controlIndex,
        cellIndex,
        cellParaIndex: cp,
      }),
      depth,
    });
  }
  return children;
}

/** 셀 문단 하나: 텍스트 수집 + 내부 중첩 표를 자식 작업으로 반환. */
function expandCellPara(
  doc: HwpDocument,
  item: Extract<WorkItem, { kind: "cellPara" }>,
  out: Array<TextSegment>,
): Array<WorkItem> {
  const { sec, parentPara, path, depth } = item;
  const pathJson = JSON.stringify(path);
  const len = safeNumber(() =>
    doc.getCellParagraphLengthByPath(sec, parentPara, pathJson),
  );
  if (len > 0) {
    const text = safeString(() =>
      doc.getTextInCellByPath(sec, parentPara, pathJson, 0, len),
    );
    if (text !== null && text.length > 0) {
      out.push({ locator: { kind: "cell", sec, parentPara, path }, text });
    }
  }
  return tableChildren(
    doc,
    sec,
    parentPara,
    path,
    MAX_CELL_CONTROLS,
    depth + 1,
  );
}

/** 중단·재개 가능한 텍스트 인덱스 빌더. */
export interface TextIndexBuilder {
  /**
   * 최대 `budgetMs` 동안 순회를 진행한다. 인덱싱이 끝났으면 true.
   * 작업 단위가 문단/셀 하나라 예산을 크게 초과하지 않는다.
   */
  step(budgetMs: number): boolean;
  /** 지금까지 수집된 세그먼트의 스냅샷. */
  snapshot(): Array<TextSegment>;
}

/**
 * 문서 전체를 순회하는 빌더를 만든다. 실제 순회는 `step()` 호출 시에만
 * 진행되므로, 호출 측에서 프레임 사이사이에 나눠 실행할 수 있다.
 */
export function createTextIndexBuilder(doc: HwpDocument): TextIndexBuilder {
  const out: Array<TextSegment> = [];
  const stack: Array<WorkItem> = [];

  const secCount = safeNumber(() => doc.getSectionCount());
  const bodyParas: Array<WorkItem> = [];
  for (let sec = 0; sec < secCount; sec += 1) {
    const paraCount = safeNumber(() => doc.getParagraphCount(sec));
    for (let para = 0; para < paraCount; para += 1) {
      bodyParas.push({ kind: "bodyPara", sec, para });
    }
  }
  pushChildren(stack, bodyParas);

  return {
    step(budgetMs) {
      const started = performance.now();
      while (stack.length > 0) {
        const item = stack.pop();
        if (!item) break;
        switch (item.kind) {
          case "bodyPara":
            pushChildren(stack, expandBodyPara(doc, item, out));
            break;
          case "table":
            pushChildren(stack, expandTable(item));
            break;
          case "cell":
            pushChildren(stack, expandCell(doc, item));
            break;
          case "cellPara":
            pushChildren(stack, expandCellPara(doc, item, out));
            break;
        }
        if (performance.now() - started >= budgetMs) return stack.length === 0;
      }
      return true;
    },
    snapshot: () => [...out],
  };
}

/**
 * 문서 전체를 한 번에 순회해 본문 + 표 셀 + 중첩 표 셀의 텍스트 세그먼트를
 * 수집한다. 대용량 문서에서는 메인 스레드를 오래 점유하므로,
 * UI에서는 `createTextIndexBuilder`로 나눠 실행할 것.
 */
export function buildTextIndex(doc: HwpDocument): Array<TextSegment> {
  const builder = createTextIndexBuilder(doc);
  builder.step(Number.POSITIVE_INFINITY);
  return builder.snapshot();
}

/**
 * 텍스트 인덱스에서 query에 매치되는 모든 위치를 찾는다.
 * 문서 순서를 그대로 따른다 (세그먼트 순서 = 문서 순서).
 */
export function findSegmentMatches(
  segments: ReadonlyArray<TextSegment>,
  query: string,
  caseSensitive: boolean,
): Array<SegmentMatch> {
  const matches: Array<SegmentMatch> = [];
  if (query.length === 0) return matches;

  const needle = caseSensitive ? query : query.toLowerCase();

  for (const segment of segments) {
    const haystack = caseSensitive ? segment.text : segment.text.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      matches.push({
        locator: segment.locator,
        charOffset: idx,
        length: query.length,
      });
      if (matches.length >= MAX_MATCHES) return matches;
      from = idx + needle.length;
    }
  }

  return matches;
}
