export type ShortcutCategory = "일반" | "패널" | "파일 저장" | "검색";

export type ShortcutId =
  | "help"
  | "panel-filelist"
  | "panel-preview"
  | "panel-result"
  | "result-fullscreen"
  | "save"
  | "save-as"
  | "find"
  | "find-next"
  | "find-prev"
  | "find-close";

export interface ShortcutDef {
  readonly id: ShortcutId;
  /** "Mod"는 macOS ⌘ / 그 외 Ctrl로 표시된다 */
  readonly keys: ReadonlyArray<string>;
  /** 동일 동작의 대체 키 조합 (표시 시 " / "로 병기) */
  readonly altKeys?: ReadonlyArray<string>;
  readonly description: string;
  readonly category: ShortcutCategory;
}

/** 앱 전역 단축키 목록 — 도움말 모달·툴팁이 공유하는 단일 소스 */
export const SHORTCUTS: ReadonlyArray<ShortcutDef> = [
  {
    id: "help",
    keys: ["F1"],
    altKeys: ["Mod", "/"],
    description: "도움말 열기/닫기",
    category: "일반",
  },
  {
    id: "panel-filelist",
    keys: ["Mod", "B"],
    description: "파일 목록 패널 표시/숨김",
    category: "패널",
  },
  {
    id: "panel-preview",
    keys: ["Mod", "Shift", "P"],
    description: "원본 미리보기 패널 표시/숨김",
    category: "패널",
  },
  {
    id: "panel-result",
    keys: ["Mod", "Shift", "R"],
    description: "변환 결과 패널 표시/숨김",
    category: "패널",
  },
  {
    id: "result-fullscreen",
    keys: ["Mod", "Shift", "F"],
    description: "결과 패널 전체화면 전환",
    category: "패널",
  },
  {
    id: "save",
    keys: ["Mod", "S"],
    description: "편집한 Markdown 저장",
    category: "파일 저장",
  },
  {
    id: "save-as",
    keys: ["Mod", "Shift", "S"],
    description: "다른 이름으로 저장",
    category: "파일 저장",
  },
  {
    id: "find",
    keys: ["Mod", "F"],
    description: "현재 패널에서 텍스트 검색",
    category: "검색",
  },
  {
    id: "find-next",
    keys: ["Enter"],
    description: "다음 검색 결과로 이동",
    category: "검색",
  },
  {
    id: "find-prev",
    keys: ["Shift", "Enter"],
    description: "이전 검색 결과로 이동",
    category: "검색",
  },
  {
    id: "find-close",
    keys: ["Escape"],
    description: "검색 닫기",
    category: "검색",
  },
];

const MAC_KEY_LABELS: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Enter: "⏎",
  Escape: "Esc",
};

const GENERIC_KEY_LABELS: Record<string, string> = {
  Mod: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Enter: "Enter",
  Escape: "Esc",
};

/** 현재 환경이 macOS인지 판별 (jsdom 등 판별 불가 시 false) */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const source = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac/i.test(source);
}

/** 키 조합을 플랫폼 관례대로 포맷 (mac: ⌘⇧P, 그 외: Ctrl+Shift+P) */
export function formatKeys(
  keys: ReadonlyArray<string>,
  isMac: boolean = isMacPlatform(),
): string {
  if (isMac) {
    return keys.map((key) => MAC_KEY_LABELS[key] ?? key).join("");
  }
  return keys.map((key) => GENERIC_KEY_LABELS[key] ?? key).join("+");
}

/** 단축키 id로 표시용 라벨 생성. 대체 조합이 있으면 " / "로 병기 */
export function shortcutLabel(
  id: ShortcutId,
  isMac: boolean = isMacPlatform(),
): string {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def) return "";
  const main = formatKeys(def.keys, isMac);
  if (!def.altKeys) return main;
  return `${main} / ${formatKeys(def.altKeys, isMac)}`;
}

/** 카테고리 표시 순서 (도움말 모달용) */
export const SHORTCUT_CATEGORIES: ReadonlyArray<ShortcutCategory> = [
  "일반",
  "패널",
  "파일 저장",
  "검색",
];

/** 카테고리별로 묶은 단축키 목록 (도움말 모달용) */
export function shortcutsByCategory(): ReadonlyArray<{
  readonly category: ShortcutCategory;
  readonly items: ReadonlyArray<ShortcutDef>;
}> {
  return SHORTCUT_CATEGORIES.map((category) => ({
    category,
    items: SHORTCUTS.filter((s) => s.category === category),
  })).filter((group) => group.items.length > 0);
}
