import { useCallback, useEffect, useState } from "react";
import { type TextSearchState, useTextSearch } from "./use-text-search";

export interface PanelSearchState {
  readonly visible: boolean;
  readonly focusToken: number;
  readonly search: TextSearchState;
  open: () => void;
  close: () => void;
}

interface UsePanelSearchOptions {
  /** Cmd+F 키 이벤트를 수신하는 컨테이너. boundary 안에서 발생한 이벤트만 처리. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  /** 실제 검색 대상 DOM. scrollable 자식 등으로 분리되어 있으면 그쪽. 생략 시 containerRef와 동일. */
  readonly contentRef?: React.RefObject<HTMLElement | null>;
  /** 콘텐츠가 바뀌면 매치를 재계산하기 위한 외부 키. */
  readonly resetKey?: unknown;
}

/**
 * 패널 단위 텍스트 검색 상태를 관리한다.
 * - Cmd/Ctrl+F: 검색바 표시 + input 재포커스 (token 증가)
 * - 검색 결과 하이라이트/이동은 useTextSearch에 위임
 *
 * 사용 패턴:
 * ```tsx
 * const { visible, focusToken, search, close } = usePanelSearch({
 *   containerRef, contentRef, resetKey: markdown,
 * });
 * <div ref={containerRef} className="relative h-full" tabIndex={-1}>
 *   <SearchBar visible={visible} focusToken={focusToken} {...search} onClose={close} />
 *   <div ref={contentRef} className="h-full overflow-y-auto">...</div>
 * </div>
 * ```
 */
export function usePanelSearch({
  containerRef,
  contentRef,
  resetKey,
}: UsePanelSearchOptions): PanelSearchState {
  const [visible, setVisible] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const search = useTextSearch({
    containerRef: contentRef ?? containerRef,
    resetKey,
  });

  const open = useCallback(() => {
    setVisible(true);
    setFocusToken((t) => t + 1);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    search.clear();
  }, [search]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const isFind = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
      if (!isFind) return;
      const target = e.target as Node | null;
      if (!target || !container.contains(target)) return;
      e.preventDefault();
      open();
    };
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, open]);

  return { visible, focusToken, search, open, close };
}
