import { create } from "zustand";

const STORAGE_KEY = "docs-to-md:settings";

interface PersistedSettings {
  readonly outputDir: string | null;
}

interface SettingsStore extends PersistedSettings {
  setOutputDir: (dir: string | null) => void;
}

function loadPersisted(): PersistedSettings {
  if (typeof window === "undefined") return { outputDir: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { outputDir: null };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return { outputDir: parsed.outputDir ?? null };
  } catch {
    return { outputDir: null };
  }
}

function persist(state: PersistedSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSettingsStore = create<SettingsStore>((set) => {
  const initial = loadPersisted();
  return {
    ...initial,
    setOutputDir: (outputDir) => {
      set({ outputDir });
      persist({ outputDir });
    },
  };
});
