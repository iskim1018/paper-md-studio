import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HwpParser } from "../src/parsers/hwp-parser.js";
import { convert } from "../src/pipeline.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE_HWP = resolve(FIXTURES, "sample.hwp");

/** CI 환경에 Java가 없으면 Java 의존 테스트를 스킵한다. */
function isJavaAvailable(): boolean {
  try {
    execSync("java -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const javaAvailable = isJavaAvailable();

describe.skipIf(!javaAvailable)("HwpParser (Java 의존)", () => {
  it("HWP 바이너리를 HWPX로 선변환 후 Markdown을 생성한다", async () => {
    const result = await convert({ inputPath: SAMPLE_HWP });

    expect(result.format).toBe("hwp");
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.elapsed).toBeGreaterThan(0);
    expect(Array.isArray(result.images)).toBe(true);
  });

  it("추출된 이미지는 정상적인 형태를 가진다", async () => {
    const result = await convert({ inputPath: SAMPLE_HWP });

    for (const img of result.images) {
      expect(img.name).toMatch(/^img_\d{3}\.[a-z]+$/);
      expect(img.mimeType).toMatch(/^image\//);
      expect(img.data.length).toBeGreaterThan(0);
    }
  });

  it("DOCS_TO_MD_HWP_JAR이 존재하지 않는 경로면 명확한 오류를 던진다", async () => {
    const prev = process.env.DOCS_TO_MD_HWP_JAR;
    process.env.DOCS_TO_MD_HWP_JAR = "/nonexistent/path/to/hwp.jar";
    try {
      const parser = new HwpParser();
      await expect(
        parser.parse(SAMPLE_HWP, { imagesDirName: "sample_images" }),
      ).rejects.toThrow(/DOCS_TO_MD_HWP_JAR/);
    } finally {
      if (prev === undefined) {
        delete process.env.DOCS_TO_MD_HWP_JAR;
      } else {
        process.env.DOCS_TO_MD_HWP_JAR = prev;
      }
    }
  });
});

describe("HwpParser (포맷 등록)", () => {
  it("pipeline이 .hwp 확장자를 지원 포맷으로 인식한다", async () => {
    // 실제 변환은 Java 필요 — 여기서는 detectFormat 에러 메시지에 .hwp가
    // 포함되는지를 확장자 대소문자 무관 에러 경로로 우회 검증한다.
    await expect(convert({ inputPath: "fake.unknown" })).rejects.toThrow(
      /\.hwp/,
    );
  });
});
