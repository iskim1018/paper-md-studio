import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PdfParser } from "../src/parsers/pdf-parser.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE = resolve(FIXTURES, "sample.pdf");

// 보안상 실제 샘플 파일은 저장소에 없음. 없으면 해당 describe 전체를 skip.
const hasPdf = existsSync(SAMPLE);

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
