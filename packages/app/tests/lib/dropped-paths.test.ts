import { describe, expect, it, vi } from "vitest";

interface FakeEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

const dirMap = new Map<string, Array<FakeEntry>>();
const statMap = new Map<string, boolean>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: async (path: string) => dirMap.get(path) ?? [],
  stat: async (path: string) => {
    const isDirectory = statMap.get(path);
    if (isDirectory === undefined) {
      throw new Error(`stat 실패: ${path}`);
    }
    return { isDirectory };
  },
}));

import { addDroppedPaths } from "../../src/lib/dropped-paths";

function file(name: string): FakeEntry {
  return { name, isDirectory: false, isFile: true };
}

function dir(name: string): FakeEntry {
  return { name, isDirectory: true, isFile: false };
}

function createSinks() {
  return {
    addFiles: vi.fn<(paths: ReadonlyArray<string>) => void>(),
    addScannedFiles: vi.fn(() => 0),
  };
}

describe("addDroppedPaths", () => {
  it("지원 확장자 파일은 addFiles로 추가한다", async () => {
    // Arrange
    dirMap.clear();
    statMap.clear();
    const sinks = createSinks();

    // Act
    await addDroppedPaths(["/docs/보고서.hwpx", "/docs/계약.pdf"], sinks);

    // Assert
    expect(sinks.addFiles).toHaveBeenCalledWith([
      "/docs/보고서.hwpx",
      "/docs/계약.pdf",
    ]);
    expect(sinks.addScannedFiles).not.toHaveBeenCalled();
  });

  it("폴더 경로는 재귀 스캔해 addScannedFiles로 추가한다", async () => {
    dirMap.clear();
    statMap.clear();
    statMap.set("/Users/me/문서모음", true);
    dirMap.set("/Users/me/문서모음", [file("보고서.hwpx"), dir("하위폴더")]);
    dirMap.set("/Users/me/문서모음/하위폴더", [file("계약서.pdf")]);
    const sinks = createSinks();

    await addDroppedPaths(["/Users/me/문서모음"], sinks);

    expect(sinks.addFiles).not.toHaveBeenCalled();
    expect(sinks.addScannedFiles).toHaveBeenCalledWith([
      { path: "/Users/me/문서모음/보고서.hwpx", groupDir: "문서모음" },
      {
        path: "/Users/me/문서모음/하위폴더/계약서.pdf",
        groupDir: "문서모음/하위폴더",
      },
    ]);
  });

  it("파일과 폴더가 섞여 있으면 각각 추가한다", async () => {
    dirMap.clear();
    statMap.clear();
    statMap.set("/root/폴더", true);
    dirMap.set("/root/폴더", [file("문서.docx")]);
    const sinks = createSinks();

    await addDroppedPaths(["/root/단일.md", "/root/폴더"], sinks);

    expect(sinks.addFiles).toHaveBeenCalledWith(["/root/단일.md"]);
    expect(sinks.addScannedFiles).toHaveBeenCalledWith([
      { path: "/root/폴더/문서.docx", groupDir: "폴더" },
    ]);
  });

  it("폴더가 아닌 미지원 파일은 무시한다", async () => {
    dirMap.clear();
    statMap.clear();
    statMap.set("/root/이미지.png", false);
    const sinks = createSinks();

    await addDroppedPaths(["/root/이미지.png"], sinks);

    expect(sinks.addFiles).not.toHaveBeenCalled();
    expect(sinks.addScannedFiles).not.toHaveBeenCalled();
  });

  it("stat 실패 경로는 무시하고 나머지는 계속 처리한다", async () => {
    dirMap.clear();
    statMap.clear();
    statMap.set("/root/정상폴더", true);
    dirMap.set("/root/정상폴더", [file("ok.hwpx")]);
    const sinks = createSinks();

    await addDroppedPaths(["/root/접근불가", "/root/정상폴더"], sinks);

    expect(sinks.addScannedFiles).toHaveBeenCalledWith([
      { path: "/root/정상폴더/ok.hwpx", groupDir: "정상폴더" },
    ]);
  });

  it("스캔 결과가 비어 있으면 addScannedFiles를 호출하지 않는다", async () => {
    dirMap.clear();
    statMap.clear();
    statMap.set("/root/빈폴더", true);
    dirMap.set("/root/빈폴더", [file("무시.txt")]);
    const sinks = createSinks();

    await addDroppedPaths(["/root/빈폴더"], sinks);

    expect(sinks.addScannedFiles).not.toHaveBeenCalled();
  });
});
