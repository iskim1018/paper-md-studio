// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_HIDE_DELAY_MS,
  AUTO_HIDE_INITIAL_MS,
  useAutoHide,
} from "../../src/hooks/use-auto-hide";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeScrollRef() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return { current: el };
}

describe("useAutoHide", () => {
  it("마운트 직후에는 표시 상태다", () => {
    const { result } = renderHook(() => useAutoHide());
    expect(result.current.visible).toBe(true);
  });

  it("초기 유지 시간이 지나면 숨긴다", () => {
    const { result } = renderHook(() => useAutoHide());
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_INITIAL_MS);
    });
    expect(result.current.visible).toBe(false);
  });

  it("스크롤하면 다시 표시하고, 멈춘 뒤 지연 시간이 지나면 숨긴다", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() => useAutoHide({ scrollRef }));
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_INITIAL_MS);
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      scrollRef.current.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS);
    });
    expect(result.current.visible).toBe(false);
  });

  it("연속 스크롤 중에는 숨기지 않는다 (타이머 리셋)", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() => useAutoHide({ scrollRef }));
    act(() => {
      scrollRef.current.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS - 100);
      scrollRef.current.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS - 100);
    });
    expect(result.current.visible).toBe(true);
  });

  it("hold 중에는 타이머가 만료돼도 숨기지 않고, release 후에 숨긴다", () => {
    const { result } = renderHook(() => useAutoHide());
    act(() => {
      result.current.hold();
      vi.advanceTimersByTime(AUTO_HIDE_INITIAL_MS * 2);
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      result.current.release();
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS);
    });
    expect(result.current.visible).toBe(false);
  });

  it("숨겨진 뒤 hold하면 다시 표시된다", () => {
    const { result } = renderHook(() => useAutoHide());
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_INITIAL_MS);
    });
    expect(result.current.visible).toBe(false);
    act(() => {
      result.current.hold();
    });
    expect(result.current.visible).toBe(true);
  });

  it("언마운트 시 타이머를 정리한다", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderHook(() => useAutoHide());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
