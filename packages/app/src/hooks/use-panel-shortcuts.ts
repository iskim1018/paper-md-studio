import { useEffect } from "react";
import { useLayoutStore } from "../store/layout-store";

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

interface ShortcutMatch {
  readonly action: "filelist" | "preview" | "result";
}

function matchShortcut(event: KeyboardEvent): ShortcutMatch | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "b" && !event.shiftKey && !event.altKey) {
    return { action: "filelist" };
  }
  if (event.shiftKey && key === "p") return { action: "preview" };
  if (event.shiftKey && key === "r") return { action: "result" };
  return null;
}

/**
 * 패널 토글 전역 키보드 단축키.
 * - Cmd/Ctrl + B            : FileList 토글
 * - Cmd/Ctrl + Shift + P    : Preview 토글
 * - Cmd/Ctrl + Shift + R    : Result 토글
 *
 * Cmd/Ctrl + Shift + F (결과 전체화면)는 FullscreenToggle 컴포넌트가 자체 등록.
 */
export function usePanelShortcuts(): void {
  const toggleFileList = useLayoutStore((s) => s.toggleFileList);
  const togglePreview = useLayoutStore((s) => s.togglePreview);
  const toggleResult = useLayoutStore((s) => s.toggleResult);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event)) return;
      const match = matchShortcut(event);
      if (!match) return;
      event.preventDefault();
      switch (match.action) {
        case "filelist":
          toggleFileList();
          break;
        case "preview":
          togglePreview();
          break;
        case "result":
          toggleResult();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleFileList, togglePreview, toggleResult]);
}
