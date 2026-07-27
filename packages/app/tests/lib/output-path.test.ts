// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveRevealDir } from "../../src/lib/output-path";

describe("resolveRevealDir", () => {
  it("출력 폴더가 지정돼 있으면 그 폴더를 연다", () => {
    expect(resolveRevealDir("/out/md", "/docs/문서.hwpx")).toBe("/out/md");
  });

  it("출력 폴더가 지정돼 있으면 선택된 파일이 없어도 연다", () => {
    expect(resolveRevealDir("/out/md", null)).toBe("/out/md");
  });

  it("원본 폴더 모드면 선택된 파일이 놓인 디렉토리를 연다", () => {
    expect(resolveRevealDir(null, "/docs/보고서/문서.hwpx")).toBe(
      "/docs/보고서",
    );
  });

  it("Windows 경로도 상위 디렉토리를 찾는다", () => {
    expect(resolveRevealDir(null, "C:\\docs\\보고서\\문서.hwpx")).toBe(
      "C:\\docs\\보고서",
    );
  });

  it("루트 바로 아래 파일이면 루트를 연다", () => {
    expect(resolveRevealDir(null, "/문서.hwpx")).toBe("/");
  });

  it("원본 폴더 모드에서 선택된 파일이 없으면 열 곳이 없다", () => {
    expect(resolveRevealDir(null, null)).toBeNull();
  });

  it("URL 입력은 원본 디렉토리가 없으므로 열 곳이 없다", () => {
    expect(resolveRevealDir(null, "https://example.com/a/b")).toBeNull();
  });

  it("디렉토리 정보가 없는 경로는 열 곳이 없다", () => {
    expect(resolveRevealDir(null, "문서.hwpx")).toBeNull();
  });

  it("빈 문자열 출력 폴더는 지정되지 않은 것으로 본다", () => {
    expect(resolveRevealDir("", "/docs/문서.hwpx")).toBe("/docs");
  });
});
