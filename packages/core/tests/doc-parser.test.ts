import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DocParser } from "../src/parsers/doc-parser.js";
import { convert } from "../src/pipeline.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE_DOC = resolve(FIXTURES, "sample.doc");
const hasDocSample = existsSync(SAMPLE_DOC);

/** LibreOffice 또는 macOS textutil이 사용 가능한지 확인한다. */
function isDocConverterAvailable(): boolean {
  // LibreOffice 확인
  try {
    execSync("libreoffice --version", { stdio: "ignore" });
    return true;
  } catch {
    // fall through
  }
  try {
    execSync("soffice --version", { stdio: "ignore" });
    return true;
  } catch {
    // fall through
  }
  // macOS 기본 경로
  if (existsSync("/Applications/LibreOffice.app/Contents/MacOS/soffice")) {
    return true;
  }
  // macOS textutil fallback
  if (process.platform === "darwin" && existsSync("/usr/bin/textutil")) {
    return true;
  }
  return false;
}

const converterAvailable = isDocConverterAvailable();

describe.skipIf(!converterAvailable || !hasDocSample)(
  "DocParser (LibreOffice/textutil 의존)",
  () => {
    it("DOC 파일을 DOCX로 선변환 후 Markdown을 생성한다", async () => {
      const result = await convert({ inputPath: SAMPLE_DOC });

      expect(result.format).toBe("doc");
      expect(result.markdown.length).toBeGreaterThan(0);
      expect(result.elapsed).toBeGreaterThan(0);
      expect(Array.isArray(result.images)).toBe(true);
    });

    it("PAPER_MD_STUDIO_LIBREOFFICE가 존재하지 않는 경로면 명확한 오류를 던진다", async () => {
      const prev = process.env.PAPER_MD_STUDIO_LIBREOFFICE;
      process.env.PAPER_MD_STUDIO_LIBREOFFICE = "/nonexistent/path/to/lo";
      try {
        const parser = new DocParser();
        await expect(
          parser.parse(SAMPLE_DOC, { imagesDirName: "sample_images" }),
        ).rejects.toThrow(/PAPER_MD_STUDIO_LIBREOFFICE/);
      } finally {
        if (prev === undefined) {
          delete process.env.PAPER_MD_STUDIO_LIBREOFFICE;
        } else {
          process.env.PAPER_MD_STUDIO_LIBREOFFICE = prev;
        }
      }
    });
  },
);

describe("DocParser (포맷 등록)", () => {
  it("pipeline이 .doc 확장자를 지원 포맷으로 인식한다", async () => {
    // 실제 변환은 LibreOffice 필요 — detectFormat 에러 메시지에 .doc가
    // 포함되는지를 우회 검증한다.
    await expect(convert({ inputPath: "fake.unknown" })).rejects.toThrow(
      /\.doc/,
    );
  });
});
