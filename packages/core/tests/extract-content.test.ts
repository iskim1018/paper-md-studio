import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractContent } from "../src/html/extract-content.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const sampleHtml = readFileSync(resolve(FIXTURES, "sample.html"), "utf-8");

describe("extractContent", () => {
  it("본문을 추출하고 nav/sidebar/footer를 제거한다", () => {
    // Act
    const result = extractContent(sampleHtml);

    // Assert
    expect(result.usedReadability).toBe(true);
    expect(result.contentHtml).toContain("본문과 부가 요소를");
    expect(result.contentHtml).toContain("Readability 계열의 휴리스틱");
    expect(result.contentHtml).not.toContain("사이드바 인기글");
    expect(result.contentHtml).not.toContain("광고 배너");
    expect(result.contentHtml).not.toContain("저작권 안내");
  });

  it("문서 제목을 반환한다", () => {
    const result = extractContent(sampleHtml);

    expect(result.title).toBe("테스트 아티클 — 예제 블로그");
  });

  it("추출할 본문이 없으면 body 전체로 폴백한다", () => {
    // Arrange: Readability가 처리하기엔 너무 짧은 문서
    const shortHtml =
      "<html><head><title>짧은 문서</title></head><body><p>짧음</p></body></html>";

    // Act
    const result = extractContent(shortHtml);

    // Assert
    expect(result.usedReadability).toBe(false);
    expect(result.contentHtml).toContain("짧음");
    expect(result.title).toBe("짧은 문서");
  });

  it("깨진 HTML에서도 예외 없이 폴백한다", () => {
    const broken = "<div><p>닫히지 않은 태그";

    const result = extractContent(broken);

    expect(result.contentHtml).toContain("닫히지 않은 태그");
  });
});
