import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect } from "react";
import { useLayoutStore } from "../store/layout-store";

const SHORTCUT_HINT = "Cmd/Ctrl+Shift+F";

/**
 * 에디터(결과 패널) 전체화면 토글 버튼 + 단축키 바인딩.
 * 단축키: Cmd/Ctrl + Shift + F
 */
export function FullscreenToggle() {
  const isFullscreen = useLayoutStore((s) => s.isResultFullscreen);
  const toggle = useLayoutStore((s) => s.toggleResultFullscreen);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isShortcut =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f";
      if (!isShortcut) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  const Icon = isFullscreen ? Minimize2 : Maximize2;
  const label = isFullscreen ? "창 모드" : "전체화면";

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      title={`${label} (${SHORTCUT_HINT})`}
      data-testid="fullscreen-toggle"
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}
