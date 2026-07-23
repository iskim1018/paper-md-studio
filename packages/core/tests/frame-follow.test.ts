import { describe, expect, it } from "vitest";
import { findMainFrameSrc } from "../src/html/frame-follow.js";

const BASE = "https://blog.example.com/user/123";

describe("findMainFrameSrc", () => {
  it("본문이 빈 프레임 껍데기에서 iframe src를 절대 URL로 반환한다", () => {
    // Arrange: 네이버 블로그식 껍데기 페이지
    const html =
      "<html><head><title>블로그 제목</title><script>var a=1;</script></head>" +
      '<body><iframe id="mainFrame" name="mainFrame" src="/PostView.naver?blogId=user&logNo=123"></iframe></body></html>';

    // Act
    const result = findMainFrameSrc(html, BASE);

    // Assert
    expect(result).toBe(
      "https://blog.example.com/PostView.naver?blogId=user&logNo=123",
    );
  });

  it("본문 텍스트가 충분한 페이지는 프레임이 있어도 따라가지 않는다", () => {
    const longText = "실제 본문 내용입니다. ".repeat(30);
    const html = `<body><p>${longText}</p><iframe src="/ad-frame"></iframe></body>`;

    expect(findMainFrameSrc(html, BASE)).toBeNull();
  });

  it("여러 프레임 중 id/name에 main이 포함된 것을 우선한다", () => {
    const html =
      '<body><iframe id="adFrame" src="/ad"></iframe>' +
      '<iframe name="mainFrame" src="/content"></iframe></body>';

    expect(findMainFrameSrc(html, BASE)).toBe(
      "https://blog.example.com/content",
    );
  });

  it("main 프레임이 없으면 첫 번째 프레임을 사용한다", () => {
    const html =
      '<body><iframe src="/first"></iframe><iframe src="/second"></iframe></body>';

    expect(findMainFrameSrc(html, BASE)).toBe("https://blog.example.com/first");
  });

  it("script 텍스트는 본문 길이 판정에서 제외한다", () => {
    const longScript = `<script>${"var x = 1; ".repeat(100)}</script>`;
    const html = `<body>${longScript}<iframe src="/content"></iframe></body>`;

    expect(findMainFrameSrc(html, BASE)).toBe(
      "https://blog.example.com/content",
    );
  });

  it("http(s)가 아닌 프레임과 about:blank는 무시한다", () => {
    const html =
      '<body><iframe src="about:blank"></iframe>' +
      '<iframe src="javascript:void(0)"></iframe></body>';

    expect(findMainFrameSrc(html, BASE)).toBeNull();
  });

  it("프레임이 없는 짧은 페이지는 null을 반환한다", () => {
    expect(findMainFrameSrc("<body><p>짧음</p></body>", BASE)).toBeNull();
  });
});
