import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MERGE_LEFT } from "../src/parsers/html-tables-to-gfm.js";
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

describe("HwpParser (HWPML 경유 kordoc 경로)", () => {
  /**
   * HWPML(XML 기반 .hwp)의 병합 표도 다른 포맷과 같은 GFM 계약을 따라야 한다.
   * kordoc은 병합 표를 HTML <table>로 내므로 (2026-08-16 실측) 정규화를
   * 켜지 않으면 이 포맷만 HTML 표가 남는다.
   */
  const HWPML_WITH_MERGED_TABLE = `<?xml version="1.0" encoding="UTF-8"?>
<HWPML Version="2.8">
  <BODY>
    <SECTION>
      <P><TEXT><CHAR>표 앞 문단</CHAR></TEXT></P>
      <TABLE RowCount="2" ColCount="2">
        <ROW>
          <CELL ColAddr="0" RowAddr="0" ColSpan="2" RowSpan="1"><PARALIST><P><TEXT><CHAR>병합 제목</CHAR></TEXT></P></PARALIST></CELL>
        </ROW>
        <ROW>
          <CELL ColAddr="0" RowAddr="1"><PARALIST><P><TEXT><CHAR>가</CHAR></TEXT></P></PARALIST></CELL>
          <CELL ColAddr="1" RowAddr="1"><PARALIST><P><TEXT><CHAR>나</CHAR></TEXT></P></PARALIST></CELL>
        </ROW>
      </TABLE>
    </SECTION>
  </BODY>
</HWPML>`;

  it("HWPML 병합 표를 GFM + 병합 화살표로 내린다", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "hwpml-table-test-"));
    try {
      const path = join(tmpDir, "구공문서.hwp");
      await writeFile(path, HWPML_WITH_MERGED_TABLE, "utf-8");

      const result = await new HwpParser().parse(path, {
        imagesDirName: "구공문서_images",
      });

      expect(result.markdown).toContain("표 앞 문단");
      expect(result.markdown).toContain(`| 병합 제목 | ${MERGE_LEFT} |`);
      expect(result.markdown).toContain("| 가 | 나 |");
      expect(result.markdown).not.toContain("<table");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
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
