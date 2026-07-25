import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "../hooks/use-theme";
import { Tooltip } from "./ui/tooltip";

const LABELS: Record<Theme, string> = {
  system: "시스템",
  light: "라이트",
  dark: "다크",
};

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <Tooltip content={`테마: ${LABELS[theme]} (클릭하여 전환)`}>
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={`테마 전환 (현재: ${LABELS[theme]})`}
        className="flex items-center rounded-[6px] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)] transition-colors"
        data-testid="theme-toggle"
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}
