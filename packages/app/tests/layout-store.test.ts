// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore } from "../src/store/layout-store";

const STORAGE_KEY = "paper-md-studio:layout";

function resetStore() {
  useLayoutStore.setState({
    isResultFullscreen: false,
    showFileList: true,
    showPreview: true,
    showResult: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useLayoutStore - fullscreen (기존)", () => {
  it("초기값은 false", () => {
    expect(useLayoutStore.getState().isResultFullscreen).toBe(false);
  });

  it("setResultFullscreen(true)로 활성화할 수 있다", () => {
    useLayoutStore.getState().setResultFullscreen(true);
    expect(useLayoutStore.getState().isResultFullscreen).toBe(true);
  });

  it("toggleResultFullscreen은 현재 값을 반전한다", () => {
    useLayoutStore.getState().toggleResultFullscreen();
    expect(useLayoutStore.getState().isResultFullscreen).toBe(true);
    useLayoutStore.getState().toggleResultFullscreen();
    expect(useLayoutStore.getState().isResultFullscreen).toBe(false);
  });
});

describe("useLayoutStore - 패널 토글", () => {
  it("초기값은 모든 패널 표시", () => {
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(true);
    expect(s.showPreview).toBe(true);
    expect(s.showResult).toBe(true);
  });

  it("toggleFileList는 FileList visibility만 반전한다", () => {
    useLayoutStore.getState().toggleFileList();
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(false);
    expect(s.showPreview).toBe(true);
    expect(s.showResult).toBe(true);
  });

  it("togglePreview는 Preview visibility를 반전한다", () => {
    useLayoutStore.getState().togglePreview();
    expect(useLayoutStore.getState().showPreview).toBe(false);
  });

  it("toggleResult는 Result visibility를 반전한다", () => {
    useLayoutStore.getState().toggleResult();
    expect(useLayoutStore.getState().showResult).toBe(false);
  });

  it("invariant: 마지막 visible 패널은 끌 수 없다 — Result 단독 상태에서 Result 토글 거부", () => {
    // FileList off, Preview off, Result만 visible
    useLayoutStore.setState({
      showFileList: false,
      showPreview: false,
      showResult: true,
    });
    useLayoutStore.getState().toggleResult(); // 끄려고 시도 → 거부
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(false);
    expect(s.showPreview).toBe(false);
    expect(s.showResult).toBe(true);
  });

  it("invariant: FileList 단독 상태에서 FileList 토글 거부", () => {
    useLayoutStore.setState({
      showFileList: true,
      showPreview: false,
      showResult: false,
    });
    useLayoutStore.getState().toggleFileList();
    expect(useLayoutStore.getState().showFileList).toBe(true);
  });

  it("invariant: Preview 단독 상태에서 Preview 토글 거부", () => {
    useLayoutStore.setState({
      showFileList: false,
      showPreview: true,
      showResult: false,
    });
    useLayoutStore.getState().togglePreview();
    expect(useLayoutStore.getState().showPreview).toBe(true);
  });

  it("FileList만 visible로 만들 수 있다 (위치 기반 자유로운 조합)", () => {
    // 기본 { true, true, true } 에서 Preview/Result 끄기
    useLayoutStore.getState().togglePreview(); // → { true, false, true }
    useLayoutStore.getState().toggleResult(); // → { true, false, false }
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(true);
    expect(s.showPreview).toBe(false);
    expect(s.showResult).toBe(false);
  });
});

describe("useLayoutStore - applyPreset", () => {
  it("result-only는 Result만 표시", () => {
    useLayoutStore.getState().applyPreset("result-only");
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(false);
    expect(s.showPreview).toBe(false);
    expect(s.showResult).toBe(true);
  });

  it("preview-result는 FileList 숨김 + Preview/Result 표시", () => {
    useLayoutStore.getState().applyPreset("preview-result");
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(false);
    expect(s.showPreview).toBe(true);
    expect(s.showResult).toBe(true);
  });

  it("three-pane은 모두 표시", () => {
    useLayoutStore.getState().applyPreset("result-only");
    useLayoutStore.getState().applyPreset("three-pane");
    const s = useLayoutStore.getState();
    expect(s.showFileList).toBe(true);
    expect(s.showPreview).toBe(true);
    expect(s.showResult).toBe(true);
  });
});

describe("useLayoutStore - 영속화", () => {
  it("토글 시 localStorage에 저장된다", () => {
    useLayoutStore.getState().toggleFileList();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.showFileList).toBe(false);
    expect(parsed.showPreview).toBe(true);
    expect(parsed.showResult).toBe(true);
  });

  it("preset 적용 시도 localStorage에 저장된다", () => {
    useLayoutStore.getState().applyPreset("result-only");
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(parsed.showFileList).toBe(false);
    expect(parsed.showPreview).toBe(false);
    expect(parsed.showResult).toBe(true);
  });

  it("isResultFullscreen은 영속화하지 않는다 (단발성)", () => {
    useLayoutStore.getState().setResultFullscreen(true);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      expect(parsed.isResultFullscreen).toBeUndefined();
    }
  });
});
