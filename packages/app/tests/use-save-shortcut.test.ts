// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSaveShortcut } from "../src/hooks/use-save-shortcut";

function press(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));
}

describe("useSaveShortcut", () => {
  it("Ctrl+S는 onSave를 호출한다", () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    renderHook(() => useSaveShortcut({ onSave, onSaveAs }));

    press("s", { ctrlKey: true });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSaveAs).not.toHaveBeenCalled();
  });

  it("Cmd+S는 onSave를 호출한다 (macOS)", () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    renderHook(() => useSaveShortcut({ onSave, onSaveAs }));

    press("s", { metaKey: true });

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("Ctrl+Shift+S는 onSaveAs를 호출한다", () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    renderHook(() => useSaveShortcut({ onSave, onSaveAs }));

    press("s", { ctrlKey: true, shiftKey: true });

    expect(onSaveAs).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("단일 S 키는 무시한다", () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    renderHook(() => useSaveShortcut({ onSave, onSaveAs }));

    press("s");

    expect(onSave).not.toHaveBeenCalled();
    expect(onSaveAs).not.toHaveBeenCalled();
  });

  it("enabled=false면 아무것도 호출하지 않는다", () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    renderHook(() => useSaveShortcut({ onSave, onSaveAs, enabled: false }));

    press("s", { ctrlKey: true });
    press("s", { ctrlKey: true, shiftKey: true });

    expect(onSave).not.toHaveBeenCalled();
    expect(onSaveAs).not.toHaveBeenCalled();
  });

  it("unmount 시 이벤트 리스너를 정리한다", () => {
    const onSave = vi.fn();
    const { unmount } = renderHook(() =>
      useSaveShortcut({ onSave, onSaveAs: vi.fn() }),
    );

    unmount();
    press("s", { ctrlKey: true });

    expect(onSave).not.toHaveBeenCalled();
  });
});
