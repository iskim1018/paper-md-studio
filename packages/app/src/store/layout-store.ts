import { create } from "zustand";

interface LayoutStore {
  /** 결과 패널(에디터)만 화면에 표시하는 전체화면 모드 */
  readonly isResultFullscreen: boolean;
  setResultFullscreen: (value: boolean) => void;
  toggleResultFullscreen: () => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  isResultFullscreen: false,
  setResultFullscreen: (value) => set({ isResultFullscreen: value }),
  toggleResultFullscreen: () =>
    set((state) => ({ isResultFullscreen: !state.isResultFullscreen })),
}));
