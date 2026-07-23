import { describe, expect, it } from "vitest";
import { resolveUrls } from "../src/html/resolve-urls.js";

const BASE = "https://example.com/blog/post/";

describe("resolveUrls", () => {
  it("상대 경로 src/href를 baseUrl 기준 절대 경로로 바꾼다", () => {
    // Arrange
    const html =
      '<img src="images/pic.png"><a href="../about">소개</a>' +
      '<a href="/terms">약관</a>';

    // Act
    const result = resolveUrls(html, BASE);

    // Assert
    expect(result).toContain(
      'src="https://example.com/blog/post/images/pic.png"',
    );
    expect(result).toContain('href="https://example.com/blog/about"');
    expect(result).toContain('href="https://example.com/terms"');
  });

  it("절대 URL·앵커·mailto는 그대로 둔다", () => {
    const html =
      '<a href="https://other.example/page">외부</a>' +
      '<a href="#section">앵커</a>' +
      '<a href="mailto:hi@example.com">메일</a>';

    const result = resolveUrls(html, BASE);

    expect(result).toContain('href="https://other.example/page"');
    expect(result).toContain('href="#section"');
    expect(result).toContain('href="mailto:hi@example.com"');
  });

  it("baseUrl이 없으면 원본을 그대로 반환한다", () => {
    const html = '<img src="images/pic.png">';

    expect(resolveUrls(html)).toBe(html);
  });
});
