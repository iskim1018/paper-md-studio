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
 * 셀 문단 하나를 처리한다: 텍스트가 있으면 세그먼트로 수집하고,
 * 문단 내부의 중첩 표를 재귀한다.
 */
function visitCellPara(
  doc: HwpDocument,
  sec: number,
  parentPara: number,
  cellParaPath: ReadonlyArray<CellPathEntry>,
  depth: number,
  out: Array<TextSegment>,
): void {
  const pathJson = JSON.stringify(cellParaPath);
  const len = safeNumber(() =>
    doc.getCellParagraphLengthByPath(sec, parentPara, pathJson),
  );
  if (len > 0) {
    const text = safeString(() =>
      doc.getTextInCellByPath(sec, parentPara, pathJson, 0, len),
    );
    if (text !== null && text.length > 0) {
      out.push({
        locator: { kind: "cell", sec, parentPara, path: cellParaPath },
        text,
      });
    }
  }

  // 셀 문단 내부의 중첩 표 탐색
  for (let nc = 0; nc < MAX_CELL_CONTROLS; nc += 1) {
    const nestedTablePath: Array<CellPathEntry> = [
      ...cellParaPath,
      { controlIndex: nc, cellIndex: 0, cellParaIndex: 0 },
    ];
    if (probeTable(doc, sec, parentPara, nestedTablePath) !== null) {
      visitTable(doc, sec, parentPara, nestedTablePath, depth + 1, out);
    }
  }
}

/**
 * path 마지막 요소의 controlIndex가 가리키는 표를 순회한다.
 * 각 셀의 각 문단을 visitCellPara로 처리한다.
 */
function visitTable(
  doc: HwpDocument,
  sec: number,
  parentPara: number,
  tablePath: ReadonlyArray<CellPathEntry>,
  depth: number,
  out: Array<TextSegment>,
): void {
  if (depth > MAX_DEPTH) return;
  const cellCount = probeTable(doc, sec, parentPara, tablePath);
  if (cellCount === null) return;

  const lastEntry = tablePath[tablePath.length - 1];
  if (!lastEntry) return;
  const controlIndex = lastEntry.controlIndex;

  for (let cell = 0; cell < cellCount; cell += 1) {
    const cellPath0 = withLastEntry(tablePath, {
      controlIndex,
      cellIndex: cell,
      cellParaIndex: 0,
    });
    const cpCount = safeNumber(() =>
      doc.getCellParagraphCountByPath(
        sec,
        parentPara,
        JSON.stringify(cellPath0),
      ),
    );
    for (let cp = 0; cp < cpCount; cp += 1) {
      const cellParaPath = withLastEntry(tablePath, {
        controlIndex,
        cellIndex: cell,
        cellParaIndex: cp,
      });
      visitCellPara(doc, sec, parentPara, cellParaPath, depth, out);
    }
  }
}

/** 본문 문단 하나를 처리한다: 본문 텍스트 + 문단 내 표들. */
function visitBodyPara(
  doc: HwpDocument,
  sec: number,
  para: number,
  out: Array<TextSegment>,
): void {
  const bodyLen = safeNumber(() => doc.getParagraphLength(sec, para));
  if (bodyLen > 0) {
    const text = safeString(() => doc.getTextRange(sec, para, 0, bodyLen));
    if (text !== null && text.length > 0) {
      out.push({ locator: { kind: "body", sec, para }, text });
    }
  }

  const ctrlCount = controlCount(doc, sec, para);
  for (let ctrl = 0; ctrl < ctrlCount; ctrl += 1) {
    const tablePath: Array<CellPathEntry> = [
      { controlIndex: ctrl, cellIndex: 0, cellParaIndex: 0 },
    ];
    if (probeTable(doc, sec, para, tablePath) !== null) {
      visitTable(doc, sec, para, tablePath, 1, out);
    }
  }
}

/**
 * 문서 전체를 순회해 본문 + 표 셀 + 중첩 표 셀의 텍스트 세그먼트를 수집한다.
 * 문서당 1회만 호출하고 결과를 캐싱하는 것을 권장한다.
 */
export function buildTextIndex(doc: HwpDocument): Array<TextSegment> {
  const out: Array<TextSegment> = [];
  const secCount = safeNumber(() => doc.getSectionCount());

  for (let sec = 0; sec < secCount; sec += 1) {
    const paraCount = safeNumber(() => doc.getParagraphCount(sec));
    for (let para = 0; para < paraCount; para += 1) {
      visitBodyPara(doc, sec, para, out);
    }
  }

  return out;
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
