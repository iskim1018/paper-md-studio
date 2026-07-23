import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../src/html/sanitize-html.js";

describe("sanitizeHtml", () => {
  it("script/style/iframe 등 비콘텐츠 요소를 제거한다", () => {
    // Arrange
    const html = [
      "<p>본문</p>",
      "<script>alert(1)</script>",
      "<style>p{color:red}</style>",
      "<noscript>JS 꺼짐</noscript>",
      '<iframe src="https://evil.example"></iframe>',
    ].join("");

    // Act
    const result = sanitizeHtml(html);

    // Assert
    expect(result).toContain("본문");
    expect(result).not.toContain("alert(1)");
    expect(result).not.toContain("color:red");
    expect(result).not.toContain("JS 꺼짐");
    expect(result).not.toContain("iframe");
  });

  it("on* 이벤트 핸들러 속성을 제거한다", () => {
    const html = '<p onclick="steal()" onmouseover="track()">클릭</p>';

    const result = sanitizeHtml(html);

    expect(result).toContain("클릭");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onmouseover");
  });

  it("javascript: URI를 제거한다", () => {
    const html = '<a href="javascript:alert(1)">링크</a>';

    const result = sanitizeHtml(html);

    expect(result).toContain("링크");
    expect(result).not.toContain("javascript:");
  });

  it("탭·제어문자로 난독화된 javascript: URI도 제거한다", () => {
    // 브라우저는 URL 파싱 전 탭/개행/제어문자를 제거하므로 우회 가능한 패턴들
    const cases = [
      '<a href="java\tscript:alert(1)">A</a>',
      '<a href="java&#09;script:alert(1)">B</a>',
      '<a href="\u0001javascript:alert(1)">C</a>',
      '<a href="JaVa\nScRiPt:alert(1)">D</a>',
      '<a href="vbscript:msgbox(1)">E</a>',
    ];

    for (const html of cases) {
      const result = sanitizeHtml(html);
      expect(result).not.toContain("script:");
    }
  });

  it("data: URI는 이미지만 허용한다", () => {
    const html =
      '<img src="data:image/png;base64,iVBOR="><a href="data:text/html,<script>alert(1)</script>">D</a>';

    const result = sanitizeHtml(html);

    expect(result).toContain("data:image/png");
    expect(result).not.toContain("data:text/html");
  });

  it("일반 콘텐츠와 안전한 속성은 유지한다", () => {
    const html =
      '<h2>제목</h2><p><a href="https://example.com">링크</a></p>' +
      '<img src="https://example.com/a.png" alt="그림">';

    const result = sanitizeHtml(html);

    expect(result).toContain("<h2>제목</h2>");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('alt="그림"');
  });

  it("lazy-load 이미지의 원본 URL을 src로 승격한다", () => {
    const html =
      '<img src="https://cdn.example.com/blur.png?type=w80_blur" data-lazy-src="https://cdn.example.com/full.png">';

    const result = sanitizeHtml(html);

    expect(result).toContain('src="https://cdn.example.com/full.png"');
    expect(result).not.toContain("blur.png");
  });

  it("lazy 속성의 javascript: URI는 승격 후 제거된다", () => {
    const html =
      '<img src="https://cdn.example.com/a.png" data-lazy-src="javascript:alert(1)">';

    const result = sanitizeHtml(html);

    expect(result).not.toContain("javascript:");
  });

  it("전체 문서 입력도 body 내용만 반환한다", () => {
    const html =
      "<html><head><title>제목</title><script>x()</script></head>" +
      "<body><p>내용</p></body></html>";

    const result = sanitizeHtml(html);

    expect(result).toContain("<p>내용</p>");
    expect(result).not.toContain("<title>");
    expect(result).not.toContain("x()");
  });
});
