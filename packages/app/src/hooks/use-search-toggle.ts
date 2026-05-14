import { useCallback, useEffect, useState } from "react";

export interface SearchToggleState {
  readonly visible: boolean;
  readonly focusToken: number;
  open: () => void;
  close: () => void;
}

/**
 * 패널의 Cmd/Ctrl+F 검색바 토글 상태만 관리한다 (검색 엔진과 무관).
 * - 컨테이너 내부에서 발생한 Cmd+F만 가로채 검색바를 표시
 * - 이미 열려 있어도 Cmd+F를 다시 누르면 focusToken을 증가시켜 input 재포커스
 * - close 시 onClose 콜백으로 검색 상태 정리를 위임
 *
 * DOM 기반(useTextSearch)·rhwp 기반(useHwpxSearch) 어느 검색 엔진과도
 * 조합할 수 있도록 분리했다.
 */
export function useSearchToggle(
  containerRef: React.RefObject<HTMLElement | null>,
  onClose?: () => void,
): SearchToggleState {
  const [visible, setVisible] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  const open = useCallback(() => {
    setVisible(true);
    setFocusToken((t) => t + 1);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    onClose?.();
  }, [onClose]);

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

  return { visible, focusToken, open, close };
}
