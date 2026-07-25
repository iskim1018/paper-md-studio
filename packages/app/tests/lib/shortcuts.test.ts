import { describe, expect, it } from "vitest";
import {
  formatKeys,
  SHORTCUT_CATEGORIES,
  SHORTCUTS,
  shortcutLabel,
  shortcutsByCategory,
} from "../../src/lib/shortcuts";

describe("formatKeys", () => {
  it("macOS에서는 심볼을 구분자 없이 붙여 표시한다", () => {
    expect(formatKeys(["Mod", "Shift", "P"], true)).toBe("⌘⇧P");
    expect(formatKeys(["Mod", "B"], true)).toBe("⌘B");
  });

  it("비-macOS에서는 + 구분자로 표시한다", () => {
    expect(formatKeys(["Mod", "Shift", "P"], false)).toBe("Ctrl+Shift+P");
    expect(formatKeys(["Mod", "B"], false)).toBe("Ctrl+B");
  });

  it("특수 키 라벨을 변환한다", () => {
    expect(formatKeys(["Escape"], false)).toBe("Esc");
    expect(formatKeys(["Shift", "Enter"], true)).toBe("⇧⏎");
    expect(formatKeys(["Shift", "Enter"], false)).toBe("Shift+Enter");
  });

  it("매핑에 없는 키는 그대로 표시한다", () => {
    expect(formatKeys(["F1"], true)).toBe("F1");
    expect(formatKeys(["F1"], false)).toBe("F1");
  });
});

describe("shortcutLabel", () => {
  it("단축키 id로 라벨을 만든다", () => {
    expect(shortcutLabel("save", true)).toBe("⌘S");
    expect(shortcutLabel("save", false)).toBe("Ctrl+S");
  });

  it("대체 키 조합이 있으면 ' / '로 병기한다", () => {
    expect(shortcutLabel("help", true)).toBe("F1 / ⌘/");
    expect(shortcutLabel("help", false)).toBe("F1 / Ctrl+/");
  });
});

describe("SHORTCUTS 레지스트리", () => {
  it("id가 중복되지 않는다", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 카테고리가 표시 순서 목록에 포함된다", () => {
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_CATEGORIES).toContain(s.category);
    }
  });

  it("shortcutsByCategory는 전체 단축키를 빠짐없이 그룹핑한다", () => {
    const grouped = shortcutsByCategory();
    const total = grouped.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(SHORTCUTS.length);
    for (const group of grouped) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});
