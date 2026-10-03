import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const HIGHLIGHT_CLASS = "text-search-match";
const ACTIVE_HIGHLIGHT_CLASS = "text-search-match-active";

export interface TextSearchState {
  readonly query: string;
  readonly matches: number;
  readonly activeIndex: number;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  clear: () => void;
}

interface UseTextSearchOptions {
  /** 검색 대상 컨테이너. ref.current가 null이면 검색 비활성. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  /** 검색 결과가 변하는 외부 트리거 (예: markdown 본문 변경). */
  readonly resetKey?: unknown;
}

interface MatchPosition {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

/**
 * 하이라이트 표시 방식.
 *
 * - CSS Custom Highlight API: DOM 을 건드리지 않고 Range 만 등록하므로 매치가
 *   수만 개여도 가볍고, 화면에 보이는 부분만 칠한다. 실물 엑셀 결과에서 흔한
 *   낱말 하나가 1.9만 곳에 걸렸는데, 매치마다 `<span>` 으로 감싸던 방식은 한
 *   번 검색에 메인 스레드를 24초 붙잡았다.
 * - `<span>` 감싸기: Highlight API 가 없는 환경(jsdom 등)의 대체.
 */
interface Highlighter {
  /** 매치를 표시하고 표시한 매치 수를 돌려준다 */
  apply(positions: ReadonlyArray<MatchPosition>): number;
  setActive(index: number): void;
  /** 활성 매치를 화면 가운데로 */
  scrollTo(index: number): void;
  clear(): void;
}

/** 요소를 감싼 가장 가까운 세로 스크롤 상자 */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    const scrollable = overflowY === "auto" || overflowY === "scroll";
    if (scrollable && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * 매치 글자 자체를 가운데로 스크롤한다. 매치를 담은 요소를 가운데로 보내면
 * 긴 코드 블록·문단·셀 안의 매치는 화면 밖에 남는다. 먼저 요소를 화면에
 * 들여 화면 밖 묶음(content-visibility)을 그리게 한 뒤, 매치 위치로 맞춘다.
 */
function scrollRangeIntoView(range: Range): void {
  const element = range.startContainer.parentElement;
  if (!element) return;
  element.scrollIntoView({ block: "nearest" });
  const scroller = scrollParent(element);
  const rect = scroller ? range.getBoundingClientRect() : null;
  if (!scroller || !rect || rect.height === 0) {
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  const box = scroller.getBoundingClientRect();
  scroller.scrollBy({
    top: rect.top + rect.height / 2 - (box.top + box.height / 2),
    behavior: "smooth",
  });
}

interface HighlightLike {
  add(range: Range): void;
  delete(range: Range): boolean;
  priority: number;
}

interface HighlightApi {
  readonly registry: {
    get(name: string): HighlightLike | undefined;
    set(name: string, highlight: HighlightLike): void;
  };
  readonly Highlight: new () => HighlightLike;
}

function highlightApi(): HighlightApi | null {
  const css = (
    globalThis as { CSS?: { highlights?: HighlightApi["registry"] } }
  ).CSS;
  const ctor = (globalThis as { Highlight?: HighlightApi["Highlight"] })
    .Highlight;
  if (!css?.highlights || typeof ctor !== "function") return null;
  return { registry: css.highlights, Highlight: ctor };
}

/**
 * 이름별 Highlight 는 문서 전체가 하나를 공유한다. 여러 패널(원본 뷰어와
 * 결과 미리보기)이 동시에 검색해도 서로 지우지 않도록 인스턴스는 자기 Range
 * 만 넣고 뺀다.
 */
function sharedHighlight(
  api: HighlightApi,
  name: string,
  priority: number,
): HighlightLike {
  const existing = api.registry.get(name);
  if (existing) return existing;
  const created = new api.Highlight();
  created.priority = priority;
  api.registry.set(name, created);
  return created;
}

function createRangeHighlighter(api: HighlightApi): Highlighter {
  const all = sharedHighlight(api, HIGHLIGHT_CLASS, 0);
  const active = sharedHighlight(api, ACTIVE_HIGHLIGHT_CLASS, 1);
  let ranges: Array<Range> = [];
  let activeRange: Range | null = null;

  const clearActive = () => {
    if (activeRange) active.delete(activeRange);
    activeRange = null;
  };
  const clear = () => {
    clearActive();
    for (const range of ranges) all.delete(range);
    ranges = [];
  };

  return {
    apply(positions) {
      clear();
      ranges = positions.map((p) => {
        const range = document.createRange();
        range.setStart(p.node, p.start);
        range.setEnd(p.node, p.end);
        all.add(range);
        return range;
      });
      return ranges.length;
    },
    setActive(index) {
      clearActive();
      const range = ranges[index];
      if (!range) return;
      active.add(range);
      activeRange = range;
    },
    scrollTo(index) {
      const range = ranges[index];
      if (range) scrollRangeIntoView(range);
    },
    clear,
  };
}

function createSpanHighlighter(root: HTMLElement): Highlighter {
  let elements: Array<HTMLElement> = [];

  const clear = () => {
    const spans = root.querySelectorAll(`span.${HIGHLIGHT_CLASS}`);
    for (const span of Array.from(spans)) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    elements = [];
  };

  return {
    apply(positions) {
      clear();
      // 같은 노드에 여러 매치가 있으면 뒤에서부터 감싸야 offset 이 안 깨진다.
      // 위치는 문서 순서로 들어오므로 노드 순서는 지키고 노드 안에서만 뒤집는다
      const byNode = new Map<Text, Array<MatchPosition>>();
      for (const p of positions) {
        byNode.set(p.node, [...(byNode.get(p.node) ?? []), p]);
      }
      const wrapped: Array<HTMLElement> = [];
      for (const list of byNode.values()) {
        const inNode: Array<HTMLElement> = [];
        for (const m of [...list].reverse()) {
          const range = document.createRange();
          range.setStart(m.node, m.start);
          range.setEnd(m.node, m.end);
          const span = document.createElement("span");
          span.className = HIGHLIGHT_CLASS;
          try {
            range.surroundContents(span);
            inNode.unshift(span);
          } catch {
            // 노드 경계가 안 맞을 수 있음 — 그 매치는 스킵
          }
        }
        wrapped.push(...inNode);
      }
      elements = wrapped;
      return wrapped.length;
    },
    setActive(index) {
      elements.forEach((el, i) => {
        el.classList.toggle(ACTIVE_HIGHLIGHT_CLASS, i === index);
      });
    },
    scrollTo(index) {
      elements[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    clear,
  };
}

/**
 * 컨테이너 안 텍스트 노드를 TreeWalker로 순회하며 query에 매치되는 위치를
 * 수집하고, 하이라이트한 뒤(위 `Highlighter`) 활성 매치로 스크롤한다.
 *
 * 한계: 매치는 단일 텍스트 노드 안에서만 검색한다 (인라인 마크업 경계
 * 너머는 검색 안 됨). 마크다운 본문에서 거의 문제 없음.
 */
export function useTextSearch({
  containerRef,
  resetKey,
}: UseTextSearchOptions): TextSearchState {
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [matches, setMatches] = useState(0);
  // 다시 검색한 직후 활성 표시를 그 자리에서 다시 달려고 현재 순번을 들고 있는다
  // (매치 수·순번이 그대로면 아래 활성 effect 가 다시 돌지 않는다)
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // 하이라이터를 렌더 사이에 유지한다
  const session = useMemo<{
    highlighter: Highlighter | null;
    root: HTMLElement | null;
  }>(() => ({ highlighter: null, root: null }), []);

  const highlighterFor = useCallback(
    (root: HTMLElement): Highlighter => {
      if (session.highlighter && session.root === root) {
        return session.highlighter;
      }
      session.highlighter?.clear();
      const api = highlightApi();
      session.highlighter = api
        ? createRangeHighlighter(api)
        : createSpanHighlighter(root);
      session.root = root;
      return session.highlighter;
    },
    [session],
  );

  const findMatches = useCallback(
    (root: HTMLElement, q: string): Array<MatchPosition> => {
      if (!q) return [];
      const lowerQuery = q.toLowerCase();
      // 검색창·스크립트가 컨테이너 안에 없으면 텍스트 노드마다 조상을 거슬러
      // 올라가며 확인할 필요가 없다 (큰 문서에서는 이 확인이 순회 비용 대부분)
      const mayContainSkipped =
        root.querySelector("[data-search-ui], script, style") !== null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent || !node.textContent) return NodeFilter.FILTER_REJECT;
          // search bar 자신의 input 내부·스크립트는 스킵
          if (
            mayContainSkipped &&
            parent.closest("[data-search-ui], script, style")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const results: Array<MatchPosition> = [];
      let current = walker.nextNode();
      while (current) {
        const lowerText = (current.textContent ?? "").toLowerCase();
        let idx = 0;
        while (true) {
          const pos = lowerText.indexOf(lowerQuery, idx);
          if (pos === -1) break;
          results.push({
            node: current as Text,
            start: pos,
            end: pos + q.length,
          });
          idx = pos + q.length;
        }
        current = walker.nextNode();
      }
      return results;
    },
    [],
  );

  // query 또는 resetKey 변경 시 매치 재계산
  useEffect(() => {
    void resetKey;
    const root = containerRef.current;
    if (!root || !query) {
      session.highlighter?.clear();
      setMatches(0);
      setActiveIndex(0);
      return;
    }
    const highlighter = highlighterFor(root);
    const count = highlighter.apply(findMatches(root, query));
    const nextIndex =
      count === 0 ? 0 : Math.min(activeIndexRef.current, count - 1);
    if (count > 0) highlighter.setActive(nextIndex);
    setMatches(count);
    setActiveIndex(nextIndex);
  }, [query, resetKey, containerRef, findMatches, highlighterFor, session]);

  // activeIndex 변경 시 해당 매치만 active 표시 + scroll
  useEffect(() => {
    if (matches === 0) return;
    session.highlighter?.setActive(activeIndex);
    session.highlighter?.scrollTo(activeIndex);
  }, [activeIndex, matches, session]);

  // unmount 시 하이라이트 제거
  useEffect(() => {
    return () => {
      session.highlighter?.clear();
      session.highlighter = null;
      session.root = null;
    };
  }, [session]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setActiveIndex(0);
  }, []);

  const next = useCallback(() => {
    setActiveIndex((prev) => {
      if (matches === 0) return 0;
      return (prev + 1) % matches;
    });
  }, [matches]);

  const prev = useCallback(() => {
    setActiveIndex((p) => {
      if (matches === 0) return 0;
      return (p - 1 + matches) % matches;
    });
  }, [matches]);

  const clear = useCallback(() => {
    setQueryState("");
    setActiveIndex(0);
  }, []);

  return { query, matches, activeIndex, setQuery, next, prev, clear };
}
