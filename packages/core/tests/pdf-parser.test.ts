import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PdfParser, resolvePdfEngine } from "../src/parsers/pdf-parser.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE = resolve(FIXTURES, "sample.pdf");

// 보안상 실제 샘플 파일은 저장소에 없음. 없으면 해당 describe 전체를 skip.
const hasPdf = existsSync(SAMPLE);

/** 최소 유효 PDF (1페이지, Helvetica, ASCII 텍스트) — 엔진 경로 검증용 합성 픽스처 */
function minimalPdf(line1: string, line2: string): Buffer {
  const content = `BT /F1 24 Tf 72 720 Td (${line1}) Tj 0 -40 Td (${line2}) Tj ET`;
  const objs = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: Array<number> = [0];
  for (const obj of objs) {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  }
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("resolvePdfEngine (엔진 선택)", () => {
  it("기본값은 pdf-inspector다 — 표 감지·읽기 순서 실측 우위 (2026-08-17)", () => {
    expect(resolvePdfEngine({})).toBe("inspector");
  });

  it("PAPER_MD_STUDIO_PDF_ENGINE=legacy면 기존 pdf2md 경로를 쓴다", () => {
    expect(resolvePdfEngine({ PAPER_MD_STUDIO_PDF_ENGINE: "legacy" })).toBe(
      "legacy",
    );
  });

  it("모르는 값은 무시하고 기본값으로 간다 — 오타로 엔진이 바뀌면 안 된다", () => {
    for (const value of ["Legacy", "LEGACY", "pdf2md", "", " legacy"]) {
      expect(resolvePdfEngine({ PAPER_MD_STUDIO_PDF_ENGINE: value })).toBe(
        "inspector",
      );
    }
  });
});

describe("PdfParser 엔진 경로 (합성 PDF)", () => {
  let tmpDir: string;
  let pdfPath: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pdf-engine-test-"));
    pdfPath = join(tmpDir, "synthetic.pdf");
    await writeFile(pdfPath, minimalPdf("Hello Inspector", "Second line here"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.PAPER_MD_STUDIO_PDF_ENGINE;
  });

  it("기본(inspector) 경로가 텍스트를 추출한다", async () => {
    const result = await new PdfParser().parse(pdfPath, {
      imagesDirName: "synthetic_images",
    });

    expect(result.markdown).toContain("Hello Inspector");
    expect(result.markdown).toContain("Second line here");
    expect(result.warnings).toBeUndefined();
  });

  it("legacy 경로도 같은 텍스트를 추출한다 — 폴백 보험", async () => {
    process.env.PAPER_MD_STUDIO_PDF_ENGINE = "legacy";
    const result = await new PdfParser().parse(pdfPath, {
      imagesDirName: "synthetic_images",
    });

    expect(result.markdown).toContain("Hello Inspector");
  });
});

describe.skipIf(!hasPdf)("PdfParser", () => {
  async function convertSample(): Promise<string> {
    const result = await new PdfParser().parse(SAMPLE, {
      imagesDirName: "sample_images",
    });
    expect(result.markdown).not.toBeNull();
    return result.markdown ?? "";
  }

  it("겹쳐 그린 글자가 반복되지 않는다", async () => {
    // Arrange & Act
    const markdown = await convertSample();

    // Assert — 굵게를 흉내낸 겹쳐 그리기 탓에 같은 낱말이 연달아 반복되던 문제
    expect(markdown).not.toMatch(/(\p{Script=Hangul}{2,})\1/u);
  }, 60_000);

  it("붙어 있던 숫자와 한글 사이에 공백이 끼지 않는다", async () => {
    // Arrange & Act
    const markdown = await convertSample();

    // Assert — pdf2md 가 숫자 경계마다 런을 끊어 `제21조` 가 `제 21 조` 로 벌어지던 문제
    expect(markdown).toContain("제21조");
    expect(markdown).not.toContain("제 21 조");
  }, 60_000);

  it("점선 리더가 남지 않고 목차가 목록으로 정리된다", async () => {
    // Arrange & Act
    const markdown = await convertSample();

    // Assert
    expect(markdown).not.toMatch(/[.·]{4,}/);
    expect(markdown).toMatch(/^- .+ — \d+$/m);
  }, 60_000);

  it("줄 앞뒤에 불필요한 공백을 남기지 않는다", async () => {
    // Arrange & Act
    const markdown = await convertSample();

    // Assert
    expect(markdown).not.toMatch(/[ \t]$/m);
    expect(markdown).not.toMatch(/^ (?! )/m);
  }, 60_000);
});
