// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../src/store/settings-store";

const STORAGE_KEY = "paper-md-studio:settings";

describe("useSettingsStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({ outputDir: null });
  });

  it("초기값: outputDir = null", () => {
    expect(useSettingsStore.getState().outputDir).toBeNull();
  });

  it("setOutputDir 호출 시 상태가 갱신되고 localStorage에 영속화된다", () => {
    useSettingsStore.getState().setOutputDir("/Users/test/out");

    expect(useSettingsStore.getState().outputDir).toBe("/Users/test/out");
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.outputDir).toBe("/Users/test/out");
  });

  it("setOutputDir(null)로 원본 폴더 모드로 되돌릴 수 있다", () => {
    useSettingsStore.getState().setOutputDir("/tmp");
    useSettingsStore.getState().setOutputDir(null);

    expect(useSettingsStore.getState().outputDir).toBeNull();
  });
});
