import { describe, expect, it } from "vitest";
import {
  hwpxHtmlToMarkdown,
  leadingBlockSafeHtml,
  rawMarkdownHtml,
  stripRawMarkers,
} from "../src/parsers/hwpx/markdown.js";

/**
 * HWPX 전용 turndown 서비스.
 *
 * HWPX 파서는 문단 머리 번호·수식처럼 escape 하면 안 되는 조각을 전용 요소로
 * 감싸 넘긴다. 이 요소를 모든 포맷이 공유하는 서비스에 두면 HTML 문서가 같은
 * 태그로 날것 Markdown 을 끼워 넣을 수 있었다 (#12). 그래서 규칙은 HWPX
 * 서비스에만 두고, 프로세스마다 다른 표지(nonce)가 맞는 요소만 날것으로 낸다.
 */
describe("rawMarkdownHtml — HWPX 날것 Markdown 요소", () => {
  it("문단 머리 번호·기호를 escape하지 않고 그대로 낸다", () => {
    // Arrange
    const html = `<p>${rawMarkdownHtml("1.")} 개요</p><p>${rawMarkdownHtml("-")} 항목</p>`;

    // Act
    const md = hwpxHtmlToMarkdown(html);

    // Assert
    expect(md).toBe("1. 개요\n\n- 항목");
  });

  it("수식 LaTeX의 _ * [ \\ 를 escape하지 않는다", () => {
    const md = hwpxHtmlToMarkdown(
      `<p>식 ${rawMarkdownHtml("$\\frac{a_1}{2} * [x]$")} 끝</p>`,
    );

    expect(md).toBe("식 $\\frac{a_1}{2} * [x]$ 끝");
  });

  it("표 셀 안에서도 그대로 낸다", () => {
    const md = hwpxHtmlToMarkdown(
      `<table><tr><th>${rawMarkdownHtml("$x_1$")}</th></tr></table>`,
    );

    expect(md).toContain("| $x_1$ |");
  });

  it("표지(nonce)가 없거나 틀린 요소는 날것으로 내지 않는다 (#12)", () => {
    const md = hwpxHtmlToMarkdown(
      '<p><hwpx-md>[a](javascript:alert(1))</hwpx-md> <hwpx-md data-raw="guess">[b](javascript:alert(1))</hwpx-md></p>',
    );

    expect(md).toBe(
      "\\[a\\](javascript:alert(1)) \\[b\\](javascript:alert(1))",
    );
  });

  it("뷰어용 HTML에서는 표지를 지워 밖으로 새지 않게 한다", () => {
    const html = `<p>${rawMarkdownHtml("1.")} ${leadingBlockSafeHtml("개요")}</p>`;

    const viewer = stripRawMarkers(html);

    expect(viewer).toBe("<p>1. 개요</p>");
  });
});

describe("leadingBlockSafeHtml — 줄 머리 블록 문법 막기 (#11)", () => {
  it.each([
    ["1) 하위", "1\\) 하위"],
    ["2024.", "2024\\."],
    ["2024. 3. 1.", "2024\\. 3. 1."],
    ["- 항목", "\\- 항목"],
    ["+ 항목", "\\+ 항목"],
    ["+", "\\+"],
    ["> 비고", "\\> 비고"],
    ["# 제목", "\\# 제목"],
    ["#", "\\#"],
    ["보통 글", "보통 글"],
  ])("'%s' → '%s'", (text, expected) => {
    const md = hwpxHtmlToMarkdown(
      `<p>${rawMarkdownHtml("1.")} ${leadingBlockSafeHtml(text)}</p>`,
    );

    expect(md).toBe(`1. ${expected}`);
  });
});

describe("HWPX 본문의 '$' (#23)", () => {
  it("본문 글자의 '$'는 '\\$'로 escape한다", () => {
    expect(hwpxHtmlToMarkdown("<p>US$5 와 US$10</p>")).toBe(
      "US\\$5 와 US\\$10",
    );
  });

  it("인라인 코드 안의 '$'는 그대로 둔다", () => {
    expect(hwpxHtmlToMarkdown("<p><code>a$b</code></p>")).toBe("`a$b`");
  });
});
