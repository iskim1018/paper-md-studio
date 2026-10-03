import { describe, expect, it } from "vitest";
import {
  hwpxBlocksToMarkdown,
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

/**
 * 최상위 블록을 묶음 단위로 turndown 에 넘긴다 — 문서 전체를 DOM 하나로 만들면
 * 본문 XML 16MB(문단 64만 개)에 DOM 만 750MB 를 썼다. 묶음으로 나눠도 결과는
 * 문서 전체를 한 번에 변환한 것과 바이트 단위로 같아야 한다.
 */
describe("hwpxBlocksToMarkdown — 블록 묶음 변환", () => {
  const BLOCKS: ReadonlyArray<string> = [
    "<p>보통 문단</p>\n",
    "<p></p>\n",
    "<p>끝 줄바꿈<br></p>\n",
    "<p><br>앞 줄바꿈</p>\n",
    "<p><strong>굵게</strong> </p>\n",
    "<p>끝 공백 </p>\n",
    `<p>${rawMarkdownHtml("\t탭으로 시작")}</p>\n`,
    `<p>${rawMarkdownHtml("공백으로 끝  ")}</p>\n`,
    `<p>${rawMarkdownHtml("1.")} ${leadingBlockSafeHtml("1) 하위")}</p>\n`,
    "<h1>제목</h1>\n",
    "<h2>부제목 <em>기울임</em></h2>\n",
    "<ul>\n<li>가</li>\n<li>나<br></li>\n</ul>\n",
    "<table>\n<tr><th>a</th><th>b</th></tr>\n<tr><td>1<br>2</td><td></td></tr>\n</table>\n",
    "<table>\n<tr><td></td></tr>\n</table>\n",
    '<p><img src="images/a.png" alt="그림"></p>\n',
    '<p><a href="https://example.com/">링크</a> 뒤</p>\n',
    "<p>US$5 *별* _밑줄_</p>\n",
    "<p>   </p>\n",
  ];

  /** 결정적 의사난수 — 실패를 재현할 수 있게 */
  function randomSequences(count: number): Array<Array<string>> {
    let seed = 20261003;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    return Array.from({ length: count }, () =>
      Array.from(
        { length: Math.floor(next() * 12) },
        () => BLOCKS[Math.floor(next() * BLOCKS.length)] ?? "",
      ),
    );
  }

  it.each([
    1, 2, 3, 5,
  ])("묶음 크기 %i 로 나눠도 한 번에 변환한 것과 같다", (chunkSize) => {
    // Arrange
    const sequences = [
      [...BLOCKS],
      [...BLOCKS].reverse(),
      ...randomSequences(150),
    ];

    for (const blocks of sequences) {
      // Act
      const chunked = hwpxBlocksToMarkdown(blocks, chunkSize);
      const whole = hwpxHtmlToMarkdown(blocks.join(""));

      // Assert
      expect(chunked).toBe(whole);
    }
  });

  it("구역 사이 줄바꿈(구역 HTML 을 잇던 \\n)이 없어도 결과가 같다", () => {
    const sections = [BLOCKS.slice(0, 7), BLOCKS.slice(7)];

    const chunked = hwpxBlocksToMarkdown(sections.flat(), 2);
    const whole = hwpxHtmlToMarkdown(
      sections.map((blocks) => blocks.join("")).join("\n"),
    );

    expect(chunked).toBe(whole);
  });

  it("빈 블록만 있으면 빈 문자열이다", () => {
    expect(hwpxBlocksToMarkdown(["<p></p>\n", "<p> </p>\n"], 1)).toBe("");
    expect(hwpxBlocksToMarkdown([])).toBe("");
  });
});
