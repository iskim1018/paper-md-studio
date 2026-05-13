import { useCallback, useEffect, useMemo, useState } from "react";

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
 * 컨테이너 안 텍스트 노드를 TreeWalker로 순회하며 query에 매치되는 위치를
 * 수집한다. 매치마다 <span class="text-search-match">로 감싸고, 현재 active
 * match에는 active 클래스를 부여 + scrollIntoView 한다.
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

  // active match에 scroll을 시키기 위해 매치 DOM 요소를 추적
  const matchElementsRef = useMemo<{ current: Array<HTMLElement> }>(
    () => ({ current: [] }),
    [],
  );

  const clearHighlights = useCallback((root: HTMLElement) => {
    const spans = root.querySelectorAll(`span.${HIGHLIGHT_CLASS}`);
    for (const span of Array.from(spans)) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
  }, []);

  const findMatches = useCallback(
    (root: HTMLElement, q: string): Array<MatchPosition> => {
      if (!q) return [];
      const lowerQuery = q.toLowerCase();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // search bar 자신의 input 내부는 스킵
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("[data-search-ui]"))
            return NodeFilter.FILTER_REJECT;
          if (parent.closest("script, style")) return NodeFilter.FILTER_REJECT;
          if (!node.textContent || node.textContent.length === 0)
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const results: Array<MatchPosition> = [];
      let current = walker.nextNode();
      while (current) {
        const text = current.textContent ?? "";
        const lowerText = text.toLowerCase();
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

  const applyHighlights = useCallback(
    (positions: ReadonlyArray<MatchPosition>): Array<HTMLElement> => {
      const elements: Array<HTMLElement> = [];
      // 같은 노드에 여러 매치가 있을 때 뒤에서부터 처리해야 offset이 안 깨짐
      const byNode = new Map<Text, Array<MatchPosition>>();
      for (const p of positions) {
        const arr = byNode.get(p.node) ?? [];
        arr.push(p);
        byNode.set(p.node, arr);
      }

      for (const [node, list] of byNode) {
        list.sort((a, b) => b.start - a.start);
        for (const m of list) {
          const range = document.createRange();
          range.setStart(m.node, m.start);
          range.setEnd(m.node, m.end);
          const span = document.createElement("span");
          span.className = HIGHLIGHT_CLASS;
          try {
            range.surroundContents(span);
            elements.push(span);
          } catch {
            // 노드 경계가 안 맞을 수 있음 — 그 매치는 스킵
          }
          // 변수 미사용 경고 회피
          void node;
        }
      }
      // 문서 순서로 다시 정렬 (DOM 위치 기반)
      elements.sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
      return elements;
    },
    [],
  );

  // query 또는 resetKey 변경 시 매치 재계산
  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      matchElementsRef.current = [];
      setMatches(0);
      setActiveIndex(0);
      return;
    }
    clearHighlights(root);
    if (!query) {
      matchElementsRef.current = [];
      setMatches(0);
      setActiveIndex(0);
      return;
    }
    const positions = findMatches(root, query);
    const elements = applyHighlights(positions);
    matchElementsRef.current = elements;
    setMatches(elements.length);
    setActiveIndex((prev) =>
      elements.length === 0 ? 0 : Math.min(prev, elements.length - 1),
    );
  }, [
    query,
    resetKey,
    containerRef,
    clearHighlights,
    findMatches,
    applyHighlights,
    matchElementsRef,
  ]);

  // activeIndex 변경 시 해당 매치만 active 클래스 + scroll
  useEffect(() => {
    const elements = matchElementsRef.current;
    if (elements.length === 0) return;
    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      if (!el) continue;
      if (i === activeIndex) {
        el.classList.add(ACTIVE_HIGHLIGHT_CLASS);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        el.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
      }
    }
  }, [activeIndex, matches, matchElementsRef]);

  // unmount/검색 종료 시 하이라이트 제거
  useEffect(() => {
    return () => {
      const root = containerRef.current;
      if (root) clearHighlights(root);
    };
  }, [containerRef, clearHighlights]);

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
