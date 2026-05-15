import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTextIndex,
  findSegmentMatches,
  type SegmentMatch,
} from "../lib/hwpx-text-index";
import type { HwpDocument } from "../lib/rhwp";

/** rhwp getSelectionRects 배열 원소. 좌표는 페이지 SVG viewBox와 동일 좌표계. */
export interface HwpHighlightRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 매치 하나 = rect 묶음 (여러 줄에 걸치면 rect 여러 개). */
interface HwpMatch {
  readonly rects: ReadonlyArray<HwpHighlightRect>;
}

export interface HwpxSearchState {
  readonly query: string;
  readonly matches: number;
  readonly activeIndex: number;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  clear: () => void;
  /** 페이지 인덱스 → 그 페이지에 그릴 하이라이트 목록. */
  readonly highlightsByPage: ReadonlyMap<
    number,
    ReadonlyArray<{ readonly rect: HwpHighlightRect; readonly active: boolean }>
  >;
  /** 현재 active 매치가 위치한 페이지 (스크롤 대상). 없으면 null. */
  readonly activePageIndex: number | null;
}

const SEARCH_DEBOUNCE_MS = 200;

/** 중첩 셀 폴백용: getTableCellBboxesByPath 배열 원소. */
interface CellBbox {
  readonly cellIdx: number;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function parseRects(json: string): Array<HwpHighlightRect> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rects: Array<HwpHighlightRect> = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.pageIndex === "number" &&
      typeof r.x === "number" &&
      typeof r.y === "number" &&
      typeof r.width === "number" &&
      typeof r.height === "number"
    ) {
      rects.push({
        pageIndex: r.pageIndex,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    }
  }
  return rects;
}

function parseBboxes(json: string): Array<CellBbox> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const bboxes: Array<CellBbox> = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const b = item as Record<string, unknown>;
    if (
      typeof b.cellIdx === "number" &&
      typeof b.pageIndex === "number" &&
      typeof b.x === "number" &&
      typeof b.y === "number" &&
      typeof b.w === "number" &&
      typeof b.h === "number"
    ) {
      bboxes.push({
        cellIdx: b.cellIdx,
        pageIndex: b.pageIndex,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
      });
    }
  }
  return bboxes;
}

/**
 * 매치 하나를 페이지 좌표 rect로 변환한다.
 * - 본문: getSelectionRects
 * - 1단계 표 셀: getSelectionRectsInCell (글자 단위 정밀 rect)
 * - 중첩 표 셀: 정밀 rect API가 없어 getTableCellBboxesByPath로 셀 전체를
 *   하이라이트한다 (글자 단위보다 거칠지만 위치는 정확).
 */
function resolveRects(
  doc: HwpDocument,
  match: SegmentMatch,
): Array<HwpHighlightRect> {
  const loc = match.locator;
  const end = match.charOffset + match.length;
  try {
    if (loc.kind === "body") {
      return parseRects(
        doc.getSelectionRects(
          loc.sec,
          loc.para,
          match.charOffset,
          loc.para,
          end,
        ),
      );
    }
    if (loc.path.length === 1) {
      const e = loc.path[0];
      if (!e) return [];
      return parseRects(
        doc.getSelectionRectsInCell(
          loc.sec,
          loc.parentPara,
          e.controlIndex,
          e.cellIndex,
          e.cellParaIndex,
          match.charOffset,
          e.cellParaIndex,
          end,
        ),
      );
    }
    const last = loc.path[loc.path.length - 1];
    if (!last) return [];
    const bboxes = parseBboxes(
      doc.getTableCellBboxesByPath(
        loc.sec,
        loc.parentPara,
        JSON.stringify(loc.path),
      ),
    );
    const cell = bboxes.find((b) => b.cellIdx === last.cellIndex);
    return cell
      ? [
          {
            pageIndex: cell.pageIndex,
            x: cell.x,
            y: cell.y,
            width: cell.w,
            height: cell.h,
          },
        ]
      : [];
  } catch {
    return [];
  }
}

/**
 * 텍스트 인덱스에서 query 매치를 찾고, 각 매치를 페이지 rect로 변환한다.
 */
function collectMatches(
  doc: HwpDocument,
  segments: ReturnType<typeof buildTextIndex>,
  query: string,
): Array<HwpMatch> {
  const segMatches = findSegmentMatches(segments, query, false);
  return segMatches.map((m) => ({ rects: resolveRects(doc, m) }));
}

interface UseHwpxSearchOptions {
  /** 검색 대상 문서. null이면 검색 비활성. */
  readonly doc: HwpDocument | null;
  /** 문서가 바뀌면 검색 상태를 초기화하기 위한 키. */
  readonly resetKey?: unknown;
}

/**
 * HWPX 뷰어 전용 검색 훅. SVG 기반 뷰어라 DOM 하이라이트(useTextSearch)를
 * 쓸 수 없으므로, 문서 트리를 직접 순회해 만든 텍스트 인덱스에서 매치를 찾고
 * rhwp 좌표 API로 rect를 받아 뷰어가 오버레이 박스를 그리도록 데이터를 준다.
 *
 * rhwp의 `searchText`는 본문 문단만 검색하므로 표 위주 문서에서는 쓸 수 없다.
 */
export function useHwpxSearch({
  doc,
  resetKey,
}: UseHwpxSearchOptions): HwpxSearchState {
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [allMatches, setAllMatches] = useState<ReadonlyArray<HwpMatch>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 문서당 1회 텍스트 인덱스 구축 (본문 + 표 셀 + 중첩 표 셀)
  const segments = useMemo(() => (doc ? buildTextIndex(doc) : []), [doc]);

  // 문서 교체 시 검색 상태 초기화
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey가 트리거
  useEffect(() => {
    setQueryState("");
    setActiveIndex(0);
    setAllMatches([]);
  }, [resetKey]);

  // query(debounced) 변경 시 매치 재수집
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!doc || !query) {
      setAllMatches([]);
      setActiveIndex(0);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const collected = collectMatches(doc, segments, query);
      setAllMatches(collected);
      setActiveIndex(0);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [doc, segments, query]);

  const matches = allMatches.length;

  const highlightsByPage = useMemo(() => {
    const map = new Map<
      number,
      Array<{ rect: HwpHighlightRect; active: boolean }>
    >();
    for (let i = 0; i < allMatches.length; i += 1) {
      const match = allMatches[i];
      if (!match) continue;
      const active = i === activeIndex;
      for (const rect of match.rects) {
        const list = map.get(rect.pageIndex) ?? [];
        list.push({ rect, active });
        map.set(rect.pageIndex, list);
      }
    }
    return map;
  }, [allMatches, activeIndex]);

  const activePageIndex = useMemo(() => {
    const match = allMatches[activeIndex];
    const firstRect = match?.rects[0];
    return firstRect ? firstRect.pageIndex : null;
  }, [allMatches, activeIndex]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setActiveIndex(0);
  }, []);

  const next = useCallback(() => {
    setActiveIndex((prev) => (matches === 0 ? 0 : (prev + 1) % matches));
  }, [matches]);

  const prev = useCallback(() => {
    setActiveIndex((p) => (matches === 0 ? 0 : (p - 1 + matches) % matches));
  }, [matches]);

  const clear = useCallback(() => {
    setQueryState("");
    setActiveIndex(0);
    setAllMatches([]);
  }, []);

  return {
    query,
    matches,
    activeIndex,
    setQuery,
    next,
    prev,
    clear,
    highlightsByPage,
    activePageIndex,
  };
}
