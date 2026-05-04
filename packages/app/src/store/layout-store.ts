import { create } from "zustand";

const STORAGE_KEY = "paper-md-studio:layout";

export type LayoutPreset =
  | "result-only" // FileList/Preview 숨김, Result만
  | "preview-result" // FileList 숨김, Preview + Result
  | "three-pane"; // 모두 표시 (기본)

interface PersistedLayout {
  readonly showFileList: boolean;
  readonly showPreview: boolean;
  readonly showResult: boolean;
}

const DEFAULT_LAYOUT: PersistedLayout = {
  showFileList: true,
  showPreview: true,
  showResult: true,
};

interface LayoutStore extends PersistedLayout {
  /** 결과 패널만 화면에 표시하는 전체화면 모드 (영속화하지 않음 — 단발성) */
  readonly isResultFullscreen: boolean;
  setResultFullscreen: (value: boolean) => void;
  toggleResultFullscreen: () => void;

  /** 좌측 패널(FileList) 토글. 단, 마지막 visible 패널은 숨길 수 없음. */
  toggleFileList: () => void;
  /** 중앙 패널(Preview) 토글. 단, 마지막 visible 패널은 숨길 수 없음. */
  togglePreview: () => void;
  /** 우측 패널(Result) 토글. 단, 마지막 visible 패널은 숨길 수 없음. */
  toggleResult: () => void;
  applyPreset: (preset: LayoutPreset) => void;
}

function ensureAtLeastOneVisible(layout: PersistedLayout): PersistedLayout {
  if (layout.showFileList || layout.showPreview || layout.showResult) {
    return layout;
  }
  // 빈 화면 방지 — Result로 fallback
  return { ...layout, showResult: true };
}

function loadPersisted(): PersistedLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>;
    return ensureAtLeastOneVisible({
      showFileList: parsed.showFileList ?? DEFAULT_LAYOUT.showFileList,
      showPreview: parsed.showPreview ?? DEFAULT_LAYOUT.showPreview,
      showResult: parsed.showResult ?? DEFAULT_LAYOUT.showResult,
    });
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function persist(state: PersistedLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * 토글 시도 시 invariant("최소 1개 visible")을 만족하면 적용, 아니면 무시.
 * 토글 액션은 호출 측에서 disabled 처리해 사용자가 마지막 패널을 끄지 못하게 막지만
 * 안전장치로 store 레벨에서도 검사한다.
 */
function applyToggle(
  current: PersistedLayout,
  field: keyof PersistedLayout,
): PersistedLayout {
  const next = { ...current, [field]: !current[field] };
  if (!next.showFileList && !next.showPreview && !next.showResult) {
    return current; // 변경 거부
  }
  return next;
}

export const useLayoutStore = create<LayoutStore>((set, get) => {
  const initial = loadPersisted();
  return {
    ...initial,
    isResultFullscreen: false,

    setResultFullscreen: (value) => set({ isResultFullscreen: value }),
    toggleResultFullscreen: () =>
      set((state) => ({ isResultFullscreen: !state.isResultFullscreen })),

    toggleFileList: () => {
      const s = get();
      const next = applyToggle(
        {
          showFileList: s.showFileList,
          showPreview: s.showPreview,
          showResult: s.showResult,
        },
        "showFileList",
      );
      set(next);
      persist(next);
    },

    togglePreview: () => {
      const s = get();
      const next = applyToggle(
        {
          showFileList: s.showFileList,
          showPreview: s.showPreview,
          showResult: s.showResult,
        },
        "showPreview",
      );
      set(next);
      persist(next);
    },

    toggleResult: () => {
      const s = get();
      const next = applyToggle(
        {
          showFileList: s.showFileList,
          showPreview: s.showPreview,
          showResult: s.showResult,
        },
        "showResult",
      );
      set(next);
      persist(next);
    },

    applyPreset: (preset) => {
      let next: PersistedLayout;
      switch (preset) {
        case "result-only":
          next = {
            showFileList: false,
            showPreview: false,
            showResult: true,
          };
          break;
        case "preview-result":
          next = {
            showFileList: false,
            showPreview: true,
            showResult: true,
          };
          break;
        case "three-pane":
          next = {
            showFileList: true,
            showPreview: true,
            showResult: true,
          };
          break;
      }
      set(next);
      persist(next);
    },
  };
});
