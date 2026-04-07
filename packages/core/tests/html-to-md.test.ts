import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/html-to-md.js";

describe("htmlToMarkdown", () => {
  it("기본 HTML을 Markdown으로 변환한다", () => {
    const md = htmlToMarkdown("<h1>제목</h1><p>본문</p>");
    expect(md).toContain("# 제목");
    expect(md).toContain("본문");
  });

  it("GFM 테이블을 변환한다", () => {
    const html = `
      <table>
        <thead><tr><th>이름</th><th>값</th></tr></thead>
        <tbody><tr><td>A</td><td>1</td></tr></tbody>
      </table>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("이름");
    expect(md).toContain("|");
  });

  it("굵은 텍스트와 기울임을 변환한다", () => {
    const md = htmlToMarkdown("<p><strong>굵게</strong> <em>기울임</em></p>");
    expect(md).toContain("**굵게**");
    expect(md).toContain("*기울임*");
  });

  it("코드 블록을 변환한다", () => {
    const md = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });
});
