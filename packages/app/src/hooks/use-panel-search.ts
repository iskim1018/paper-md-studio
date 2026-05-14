import { useSearchToggle } from "./use-search-toggle";
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
 * DOM 기반 패널 텍스트 검색 상태를 관리한다 (useTextSearch + useSearchToggle 결합).
 * SVG 기반 HWPX 뷰어는 useHwpxSearch + useSearchToggle을 직접 조합한다.
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
  const search = useTextSearch({
    containerRef: contentRef ?? containerRef,
    resetKey,
  });
  const { visible, focusToken, open, close } = useSearchToggle(
    containerRef,
    search.clear,
  );

  return { visible, focusToken, search, open, close };
}
