// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePanelShortcuts } from "../../src/hooks/use-panel-shortcuts";
import { useLayoutStore } from "../../src/store/layout-store";

function ShortcutsHost() {
  usePanelShortcuts();
  return null;
}

function resetStore() {
  useLayoutStore.setState({
    isResultFullscreen: false,
    showFileList: true,
    showPreview: true,
    showResult: true,
  });
}

function dispatchShortcut(opts: {
  key: string;
  shift?: boolean;
  meta?: boolean;
}) {
  const event = new KeyboardEvent("keydown", {
    key: opts.key,
    shiftKey: opts.shift ?? false,
    metaKey: opts.meta ?? true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
}

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("usePanelShortcuts", () => {
  it("Cmd+B로 FileList 토글", () => {
    render(<ShortcutsHost />);
    dispatchShortcut({ key: "b" });
    expect(useLayoutStore.getState().showFileList).toBe(false);
    dispatchShortcut({ key: "b" });
    expect(useLayoutStore.getState().showFileList).toBe(true);
  });

  it("Cmd+Shift+P로 Preview 토글", () => {
    render(<ShortcutsHost />);
    dispatchShortcut({ key: "p", shift: true });
    expect(useLayoutStore.getState().showPreview).toBe(false);
  });

  it("Cmd+Shift+R로 Result 토글", () => {
    render(<ShortcutsHost />);
    dispatchShortcut({ key: "r", shift: true });
    expect(useLayoutStore.getState().showResult).toBe(false);
  });

  it("meta 없이 단축키만 누르면 무시", () => {
    render(<ShortcutsHost />);
    dispatchShortcut({ key: "b", meta: false });
    expect(useLayoutStore.getState().showFileList).toBe(true);
  });

  it("input 포커스 중에는 단축키 무시 (사용자 입력 보호)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    render(<ShortcutsHost />);

    // input을 target으로 keydown 이벤트
    const event = new KeyboardEvent("keydown", {
      key: "b",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(useLayoutStore.getState().showFileList).toBe(true);
    document.body.removeChild(input);
  });
});
