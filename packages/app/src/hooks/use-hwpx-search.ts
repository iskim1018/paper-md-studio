import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HwpDocument } from "../lib/rhwp";

/** rhwp searchText 반환 형식. */
interface HwpSearchHit {
  readonly found: boolean;
  readonly wrapped: boolean;
  readonly sec: number;
  readonly para: number;
  readonly charOffset: number;
  readonly length: number;
}

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
const MAX_MATCHES = 2000;

function isSearchHit(value: unknown): value is HwpSearchHit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.found === "boolean" &&
    typeof v.sec === "number" &&
    typeof v.para === "number" &&
    typeof v.charOffset === "number" &&
    typeof v.length === "number"
  );
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

/**
 * 문서 전체에서 query에 매치되는 모든 위치를 rhwp searchText 이터레이터로
 * 수집하고, 각 매치를 getSelectionRects로 페이지 좌표 rect로 변환한다.
 *
 * searchText는 (sec, para, charOffset)부터 다음 매치 하나를 반환하며,
 * 문서 끝까지 가면 wrapped=true로 처음 매치를 다시 반환한다 →
 * wrapped를 만나면 루프를 종료한다.
 */
function collectMatches(doc: HwpDocument, query: string): Array<HwpMatch> {
  const matches: Array<HwpMatch> = [];
  let sec = 0;
  let para = 0;
  let charOffset = 0;

  for (let guard = 0; guard < MAX_MATCHES; guard += 1) {
    let hit: HwpSearchHit;
    try {
      const raw = doc.searchText(query, sec, para, charOffset, true, false);
      const parsed: unknown = JSON.parse(raw);
      if (!isSearchHit(parsed)) break;
      hit = parsed;
    } catch {
      break;
    }
    if (!hit.found) break;
    // 한 바퀴 돌아 첫 매치로 복귀 → 종료
    if (hit.wrapped && matches.length > 0) break;

    let rects: Array<HwpHighlightRect> = [];
    try {
      const rectsJson = doc.getSelectionRects(
        hit.sec,
        hit.para,
        hit.charOffset,
        hit.para,
        hit.charOffset + hit.length,
      );
      rects = parseRects(rectsJson);
    } catch {
      rects = [];
    }
    matches.push({ rects });

    // 다음 검색 시작점 = 이번 매치 끝
    sec = hit.sec;
    para = hit.para;
    charOffset = hit.charOffset + hit.length;
  }

  return matches;
}

interface UseHwpxSearchOptions {
  /** 검색 대상 문서. null이면 검색 비활성. */
  readonly doc: HwpDocument | null;
  /** 문서가 바뀌면 검색 상태를 초기화하기 위한 키. */
  readonly resetKey?: unknown;
}

/**
 * HWPX 뷰어 전용 검색 훅. SVG 기반 뷰어라 DOM 하이라이트(useTextSearch)를
 * 쓸 수 없으므로, rhwp 네이티브 검색 API로 매치 좌표를 받아 뷰어가 오버레이
 * 박스를 그리도록 데이터를 제공한다.
 */
export function useHwpxSearch({
  doc,
  resetKey,
}: UseHwpxSearchOptions): HwpxSearchState {
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [allMatches, setAllMatches] = useState<ReadonlyArray<HwpMatch>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const collected = collectMatches(doc, query);
      setAllMatches(collected);
      setActiveIndex(0);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [doc, query]);

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
