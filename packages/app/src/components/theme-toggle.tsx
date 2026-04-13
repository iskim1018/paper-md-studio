import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "../hooks/use-theme";

const LABELS: Record<Theme, string> = {
  system: "시스템",
  light: "라이트",
  dark: "다크",
};

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      title={`테마: ${LABELS[theme]} (클릭하여 전환)`}
      data-testid="theme-toggle"
    >
      <Icon size={14} />
      <span>{LABELS[theme]}</span>
    </button>
  );
}
