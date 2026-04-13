import { beforeEach, describe, expect, it } from "vitest";
import { useLayoutStore } from "../src/store/layout-store";

describe("useLayoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({ isResultFullscreen: false });
  });

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
