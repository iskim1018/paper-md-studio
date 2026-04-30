// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  // 테스트 단순화를 위해 절대 파일 경로를 그대로 echo한다.
  // 실제 Tauri 런타임은 `asset://localhost/<encoded path>` 같은 URL을 반환한다.
  convertFileSrc: (path: string) => `asset://localhost/${encodeURI(path)}`,
}));

import { isAbsoluteUrl, resolveLocalAssetUrl } from "../../src/lib/asset-url";

describe("isAbsoluteUrl", () => {
  it("recognizes http(s) and protocol-relative URLs", () => {
    expect(isAbsoluteUrl("http://example.com/foo.png")).toBe(true);
    expect(isAbsoluteUrl("https://example.com/foo.png")).toBe(true);
    expect(isAbsoluteUrl("//example.com/foo.png")).toBe(true);
  });

  it("recognizes data and blob URIs", () => {
    expect(isAbsoluteUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isAbsoluteUrl("blob:http://localhost/abc")).toBe(true);
  });

  it("treats relative paths as non-absolute", () => {
    expect(isAbsoluteUrl("./foo.png")).toBe(false);
    expect(isAbsoluteUrl("foo.png")).toBe(false);
    expect(isAbsoluteUrl("images/foo.png")).toBe(false);
  });
});

describe("resolveLocalAssetUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves leading-dot relative path against POSIX base file", () => {
    const result = resolveLocalAssetUrl(
      "./문서_images/foo.png",
      "/Users/me/Documents/문서.md",
    );
    expect(result).toBe(
      `asset://localhost/${encodeURI("/Users/me/Documents/문서_images/foo.png")}`,
    );
  });

  it("resolves bare relative path (no leading ./)", () => {
    const result = resolveLocalAssetUrl("images/foo.png", "/tmp/note.md");
    expect(result).toBe(
      `asset://localhost/${encodeURI("/tmp/images/foo.png")}`,
    );
  });

  it("uses Windows separator when base path is Windows-style", () => {
    const result = resolveLocalAssetUrl(
      "./doc_images/a.png",
      "C:\\Users\\me\\doc.md",
    );
    expect(result).toBe(
      `asset://localhost/${encodeURI("C:\\Users\\me\\doc_images\\a.png")}`,
    );
  });

  it("returns absolute URLs unchanged", () => {
    const url = "https://cdn.example.com/foo.png";
    expect(resolveLocalAssetUrl(url, "/tmp/note.md")).toBe(url);
  });

  it("returns data URIs unchanged", () => {
    const url = "data:image/png;base64,AAAA";
    expect(resolveLocalAssetUrl(url, "/tmp/note.md")).toBe(url);
  });

  it("returns fragment-only URLs unchanged", () => {
    expect(resolveLocalAssetUrl("#section", "/tmp/note.md")).toBe("#section");
  });

  it("returns empty string unchanged", () => {
    expect(resolveLocalAssetUrl("", "/tmp/note.md")).toBe("");
  });

  it("returns the source unchanged when basePath is missing", () => {
    expect(resolveLocalAssetUrl("./foo.png", "")).toBe("./foo.png");
  });

  it("decodes percent-encoded src so non-ASCII filenames are not double-encoded", () => {
    // react-markdown이 URL을 encodeURI한 상태로 넘기는 것을 시뮬레이션.
    const encoded = `./${encodeURI("문서_images")}/foo.png`;
    const result = resolveLocalAssetUrl(encoded, "/Users/me/Documents/문서.md");
    // convertFileSrc는 raw 절대경로를 받아 한 번만 인코딩해야 한다.
    expect(result).toBe(
      `asset://localhost/${encodeURI("/Users/me/Documents/문서_images/foo.png")}`,
    );
    expect(result).not.toContain("%25");
  });
});
