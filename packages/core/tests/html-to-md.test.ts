import { describe, expect, it } from "vitest";
import {
  htmlToMarkdown,
  htmlToMarkdownKeepingTables,
} from "../src/html-to-md.js";

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

describe("htmlToMarkdownKeepingTables", () => {
  it("표는 HTML 그대로 남기고 나머지는 Markdown으로 변환한다", () => {
    const html = "<h1>제목</h1><table><tr><td>셀</td></tr></table><p>본문</p>";

    const md = htmlToMarkdownKeepingTables(html);

    expect(md).toContain("# 제목");
    expect(md).toContain("본문");
    expect(md).toContain("<table");
    expect(md).toContain("셀");
    // GFM 표로 변환되면 안 된다 — 병합 정보(colspan/rowspan)가 소실된다
    expect(md).not.toMatch(/^\|.*\|$/m);
  });

  it("colspan/rowspan 속성을 보존한다", () => {
    const html =
      '<table><tr><td rowspan="2">병합</td><td colspan="2">가로</td></tr></table>';

    const md = htmlToMarkdownKeepingTables(html);

    expect(md).toContain('rowspan="2"');
    expect(md).toContain('colspan="2"');
  });

  it("중첩 표는 부모 표 블록 안에 통째로 남는다", () => {
    const html =
      "<p>앞</p><table><tr><td>바깥<table><tr><td>속</td></tr></table></td></tr></table>";

    const md = htmlToMarkdownKeepingTables(html);

    // 중첩 표가 별도 블록으로 새어나오지 않고 부모 안에 포함된다
    const topLevel = md.match(/<table[\s\S]*<\/table>/g);
    expect(topLevel).toHaveLength(1);
    expect(topLevel?.[0]).toContain("속");
  });

  it("기존 htmlToMarkdown은 표를 계속 GFM으로 변환한다 — 서비스 격리", () => {
    // keepTables 변형이 공유 서비스를 오염시키면 안 된다
    htmlToMarkdownKeepingTables("<table><tr><td>가</td></tr></table>");
    const md = htmlToMarkdown(
      "<table><thead><tr><th>가</th></tr></thead><tbody><tr><td>나</td></tr></tbody></table>",
    );

    expect(md).toContain("| 가 |");
    expect(md).not.toContain("<table");
  });
});
