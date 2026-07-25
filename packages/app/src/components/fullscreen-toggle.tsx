import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect } from "react";
import { shortcutLabel } from "../lib/shortcuts";
import { useLayoutStore } from "../store/layout-store";
import { Tooltip } from "./ui/tooltip";

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
    <Tooltip content={label} shortcut={shortcutLabel("result-fullscreen")}>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="flex items-center rounded-[6px] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)] transition-colors"
        data-testid="fullscreen-toggle"
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}
