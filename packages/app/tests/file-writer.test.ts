// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveMarkdownAs, saveMarkdownTo } from "../src/lib/file-writer";

// Tauri fs/dialog 플러그인 mock
const writeTextFile = vi.fn<(path: string, content: string) => Promise<void>>();
const saveDialog =
  vi.fn<(opts?: Record<string, unknown>) => Promise<string | null>>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...args: Array<unknown>) =>
    writeTextFile(...(args as [string, string])),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: Array<unknown>) =>
    saveDialog(...(args as [Record<string, unknown>?])),
}));

describe("saveMarkdownTo", () => {
  beforeEach(() => {
    writeTextFile.mockReset();
  });

  it("지정된 경로에 Markdown을 기록한다", async () => {
    writeTextFile.mockResolvedValueOnce(undefined);

    await saveMarkdownTo("/tmp/doc.md", "# Hello");

    expect(writeTextFile).toHaveBeenCalledWith("/tmp/doc.md", "# Hello");
  });

  it("쓰기 실패 시 오류를 전파한다", async () => {
    writeTextFile.mockRejectedValueOnce(new Error("disk full"));

    await expect(saveMarkdownTo("/tmp/doc.md", "x")).rejects.toThrow(
      "disk full",
    );
  });
});

describe("saveMarkdownAs", () => {
  beforeEach(() => {
    writeTextFile.mockReset();
    saveDialog.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("다이얼로그에서 경로를 선택하면 해당 경로로 저장한다", async () => {
    saveDialog.mockResolvedValueOnce("/Users/test/copy.md");
    writeTextFile.mockResolvedValueOnce(undefined);

    const result = await saveMarkdownAs("/tmp/doc.md", "# Hello");

    expect(saveDialog).toHaveBeenCalledOnce();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/Users/test/copy.md",
      "# Hello",
    );
    expect(result).toBe("/Users/test/copy.md");
  });

  it("사용자가 다이얼로그를 취소하면 null을 반환하고 쓰지 않는다", async () => {
    saveDialog.mockResolvedValueOnce(null);

    const result = await saveMarkdownAs("/tmp/doc.md", "# Hello");

    expect(result).toBeNull();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("기본 파일명을 원본 경로에서 추출하여 다이얼로그에 전달한다", async () => {
    saveDialog.mockResolvedValueOnce(null);

    await saveMarkdownAs("/Users/foo/보고서.md", "x");

    const opts = saveDialog.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts?.defaultPath).toBe("/Users/foo/보고서.md");
    expect(
      (opts?.filters as Array<{ extensions: Array<string> }>)?.[0]?.extensions,
    ).toContain("md");
  });
});
