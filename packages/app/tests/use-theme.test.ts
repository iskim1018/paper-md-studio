// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../src/hooks/use-theme";

const STORAGE_KEY = "docs-to-md:theme";

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("초기값은 system이다", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("setTheme(dark) 호출 시 data-theme='dark'가 적용된다", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setTheme(light)는 명시적 light override로 기록된다", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("light"));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setTheme(system)은 data-theme을 제거한다", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));
    act(() => result.current.setTheme("system"));

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("theme을 localStorage에 영속화한다", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("초기 마운트 시 localStorage 값을 복원한다", () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("cycleTheme은 system → light → dark → system 순으로 순환한다", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe("light");

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe("dark");

    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe("system");
  });
});
