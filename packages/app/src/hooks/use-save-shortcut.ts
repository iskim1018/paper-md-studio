import { useEffect } from "react";

interface SaveShortcutHandlers {
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  /** false면 훅이 아무 키도 바인딩하지 않는다. */
  readonly enabled?: boolean;
}

/**
 * Cmd/Ctrl+S → onSave, Cmd/Ctrl+Shift+S → onSaveAs 키바인딩.
 *
 * - 브라우저 기본 "페이지 저장" 동작은 preventDefault로 차단한다.
 * - input/textarea/contenteditable 등 에디터 내부 요소에서도 발생하도록
 *   특정 타겟을 제외하지 않는다 (에디터의 ctrl/cmd+S는 통상 저장 의도).
 */
export function useSaveShortcut({
  onSave,
  onSaveAs,
  enabled = true,
}: SaveShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      const isSaveKey =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (!isSaveKey) return;

      event.preventDefault();

      if (event.shiftKey) {
        onSaveAs();
      } else {
        onSave();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onSave, onSaveAs]);
}
