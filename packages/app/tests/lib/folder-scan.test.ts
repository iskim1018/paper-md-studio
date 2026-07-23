import { describe, expect, it, vi } from "vitest";

interface FakeEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

const dirMap = new Map<string, Array<FakeEntry>>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: async (path: string) => dirMap.get(path) ?? [],
}));

import { scanFolderForDocuments } from "../../src/lib/folder-scan";

function file(name: string): FakeEntry {
  return { name, isDirectory: false, isFile: true };
}

function dir(name: string): FakeEntry {
  return { name, isDirectory: true, isFile: false };
}

describe("scanFolderForDocuments", () => {
  it("하위 폴더를 재귀 탐색하고 그룹 경로를 부여한다", async () => {
    // Arrange
    dirMap.clear();
    dirMap.set("/Users/me/문서모음", [
      file("보고서.hwpx"),
      file("무시.txt"),
      dir("하위폴더"),
    ]);
    dirMap.set("/Users/me/문서모음/하위폴더", [file("계약서.pdf")]);

    // Act
    const result = await scanFolderForDocuments("/Users/me/문서모음");

    // Assert
    expect(result).toEqual([
      { path: "/Users/me/문서모음/보고서.hwpx", groupDir: "문서모음" },
      {
        path: "/Users/me/문서모음/하위폴더/계약서.pdf",
        groupDir: "문서모음/하위폴더",
      },
    ]);
  });

  it("숨김 항목(.으로 시작)은 건너뛴다", async () => {
    dirMap.clear();
    dirMap.set("/root", [file(".hidden.hwpx"), dir(".git"), file("ok.docx")]);
    dirMap.set("/root/.git", [file("내부.hwpx")]);

    const result = await scanFolderForDocuments("/root");

    expect(result.map((r) => r.path)).toEqual(["/root/ok.docx"]);
  });

  it("지원하지 않는 파일만 있으면 빈 배열을 반환한다", async () => {
    dirMap.clear();
    dirMap.set("/root", [file("img.png"), file("data.json")]);

    expect(await scanFolderForDocuments("/root")).toEqual([]);
  });
});
