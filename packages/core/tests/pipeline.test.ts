import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convert, convertToHtml } from "../src/pipeline.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("convert", () => {
  describe("포맷 감지", () => {
    it("지원하지 않는 확장자는 에러를 던진다", async () => {
      await expect(convert({ inputPath: "test.txt" })).rejects.toThrow(
        "지원하지 않는 파일 형식입니다",
      );
    });

    it("대소문자 구분 없이 확장자를 인식한다", async () => {
      await expect(
        convert({
          inputPath: resolve(FIXTURES, "sample.docx").replace(".docx", ".TXT"),
        }),
      ).rejects.toThrow("지원하지 않는 파일 형식입니다");
    });
  });

  describe("DOCX 변환", () => {
    it("DOCX를 Markdown으로 변환한다", async () => {
      const result = await convert({
        inputPath: resolve(FIXTURES, "sample.docx"),
      });

      expect(result.format).toBe("docx");
      expect(result.markdown).toContain("테스트 제목");
      expect(result.markdown).toContain("본문 텍스트입니다.");
      expect(result.elapsed).toBeGreaterThan(0);
    });
  });

  describe("HWPX 변환", () => {
    it("HWPX를 Markdown으로 변환한다", async () => {
      const result = await convert({
        inputPath: resolve(FIXTURES, "sample.hwpx"),
      });

      expect(result.format).toBe("hwpx");
      expect(result.markdown.length).toBeGreaterThan(0);
      expect(result.elapsed).toBeGreaterThan(0);
    });
  });

  describe("PDF 변환", () => {
    it("PDF를 Markdown으로 변환한다", async () => {
      const result = await convert({
        inputPath: resolve(FIXTURES, "sample.pdf"),
      });

      expect(result.format).toBe("pdf");
      expect(result.markdown).toContain("Hello");
      expect(result.elapsed).toBeGreaterThan(0);
    });
  });
});

describe("convertToHtml", () => {
  it("지원하지 않는 확장자는 에러를 던진다", async () => {
    await expect(convertToHtml({ inputPath: "test.txt" })).rejects.toThrow(
      "지원하지 않는 파일 형식입니다",
    );
  });

  it("DOCX에서 HTML을 반환한다", async () => {
    const result = await convertToHtml({
      inputPath: resolve(FIXTURES, "sample.docx"),
    });

    expect(result.format).toBe("docx");
    expect(result.html).toContain("테스트 제목");
    expect(result.html.length).toBeGreaterThan(0);
  });

  it("HWPX에서 HTML을 반환한다", async () => {
    const result = await convertToHtml({
      inputPath: resolve(FIXTURES, "sample.hwpx"),
    });

    expect(result.format).toBe("hwpx");
    expect(result.html.length).toBeGreaterThan(0);
  });

  it("PDF에서 콘텐츠를 반환한다", async () => {
    const result = await convertToHtml({
      inputPath: resolve(FIXTURES, "sample.pdf"),
    });

    expect(result.format).toBe("pdf");
    expect(result.html.length).toBeGreaterThan(0);
  });
});
