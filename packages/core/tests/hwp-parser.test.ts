import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HwpParser, resolveHwp5Engine } from "../src/parsers/hwp-parser.js";
import { convert } from "../src/pipeline.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE_HWP = resolve(FIXTURES, "sample.hwp");
// 보안상 sample.hwp는 저장소에 포함하지 않음. 없으면 Java 의존 테스트 skip.
const hasHwpSample = existsSync(SAMPLE_HWP);

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

describe.skipIf(!javaAvailable || !hasHwpSample)(
  "HwpParser (Java 폴백 경로)",
  () => {
    // 2026-08-09부터 기본값이 kordoc이다. 이 블록은 폴백으로 남겨둔 Java
    // 경로를 검증하므로 env를 명시적으로 고정해야 한다 — 안 그러면 이름과
    // 달리 kordoc을 재게 된다.
    let prevEngine: string | undefined;
    beforeEach(() => {
      prevEngine = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
      process.env.PAPER_MD_STUDIO_HWP_ENGINE = "java";
    });
    afterEach(() => {
      if (prevEngine === undefined) {
        delete process.env.PAPER_MD_STUDIO_HWP_ENGINE;
      } else {
        process.env.PAPER_MD_STUDIO_HWP_ENGINE = prevEngine;
      }
    });

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

    it("PAPER_MD_STUDIO_HWP_JAR이 존재하지 않는 경로면 명확한 오류를 던진다", async () => {
      const prev = process.env.PAPER_MD_STUDIO_HWP_JAR;
      process.env.PAPER_MD_STUDIO_HWP_JAR = "/nonexistent/path/to/hwp.jar";
      try {
        const parser = new HwpParser();
        await expect(
          parser.parse(SAMPLE_HWP, { imagesDirName: "sample_images" }),
        ).rejects.toThrow(/PAPER_MD_STUDIO_HWP_JAR/);
      } finally {
        if (prev === undefined) {
          delete process.env.PAPER_MD_STUDIO_HWP_JAR;
        } else {
          process.env.PAPER_MD_STUDIO_HWP_JAR = prev;
        }
      }
    });
  },
);

describe("resolveHwp5Engine (엔진 선택)", () => {
  it("플래그가 없으면 kordoc 직파싱을 쓴다 — 2026-08-09 기본값 전환", () => {
    expect(resolveHwp5Engine({})).toBe("kordoc");
  });

  it("PAPER_MD_STUDIO_HWP_ENGINE=java면 기존 Java 툴체인으로 되돌린다", () => {
    expect(resolveHwp5Engine({ PAPER_MD_STUDIO_HWP_ENGINE: "java" })).toBe(
      "java",
    );
  });

  it("모르는 값은 무시하고 기본값(kordoc)으로 간다 — 오타로 엔진이 바뀌면 안 된다", () => {
    // 대소문자 변형·인접 오타·공백 섞임 모두 기본 경로여야 한다.
    for (const value of ["Java", "JAVA", "jaav", "", " java", "kordoc"]) {
      expect(resolveHwp5Engine({ PAPER_MD_STUDIO_HWP_ENGINE: value })).toBe(
        "kordoc",
      );
    }
  });

  it("인자를 생략하면 process.env를 읽는다", () => {
    const prev = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
    process.env.PAPER_MD_STUDIO_HWP_ENGINE = "java";
    try {
      expect(resolveHwp5Engine()).toBe("java");
    } finally {
      if (prev === undefined) {
        delete process.env.PAPER_MD_STUDIO_HWP_ENGINE;
      } else {
        process.env.PAPER_MD_STUDIO_HWP_ENGINE = prev;
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
