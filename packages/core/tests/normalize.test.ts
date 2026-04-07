import { describe, expect, it } from "vitest";
import { normalizePath, normalizeToNFC } from "../src/normalize.js";

describe("normalizeToNFC", () => {
  it("NFD로 분리된 한글을 NFC로 합성한다", () => {
    // "한글" in NFD (자모 분리)
    const nfd = "\u1112\u1161\u11AB\u1100\u1173\u11AF";
    // "한글" in NFC (합성)
    const nfc = "한글";

    expect(normalizeToNFC(nfd)).toBe(nfc);
  });

  it("이미 NFC인 문자열은 그대로 반환한다", () => {
    expect(normalizeToNFC("한글문서.hwpx")).toBe("한글문서.hwpx");
  });

  it("영문은 영향 없이 그대로 반환한다", () => {
    expect(normalizeToNFC("document.pdf")).toBe("document.pdf");
  });

  it("한영 혼합 파일명을 정상 처리한다", () => {
    const nfd = "\u1105\u1175\u1111\u1169\u110E\u1173_v2.docx"; // "리포츠_v2.docx" in NFD
    const result = normalizeToNFC(nfd);
    expect(result).toBe(result.normalize("NFC"));
  });
});

describe("normalizePath", () => {
  it("경로 내 한글 디렉토리명을 NFC로 정규화한다", () => {
    const nfdPath =
      "/Users/test/\u1112\u1161\u11AB\u1100\u1173\u11AF/문서.hwpx";
    const result = normalizePath(nfdPath);
    expect(result).toBe(result.normalize("NFC"));
    expect(result).toContain("한글");
  });
});
