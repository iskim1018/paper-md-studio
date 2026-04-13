import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "docs-to-md:theme";
const THEMES: ReadonlyArray<Theme> = ["system", "light", "dark"];

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

/**
 * 앱 테마 상태를 관리한다. localStorage로 영속화되며
 * document.documentElement의 data-theme 속성을 동기화한다.
 *
 * - "system": 시스템 prefers-color-scheme을 따름 (기본)
 * - "light" / "dark": 명시적 override
 */
export function useTheme(): {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly cycleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const idx = THEMES.indexOf(current);
      return THEMES[(idx + 1) % THEMES.length] ?? "system";
    });
  }, []);

  return { theme, setTheme, cycleTheme };
}
