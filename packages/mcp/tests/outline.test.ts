import { describe, expect, test } from "vitest";
import { extractOutline } from "../src/outline/extract.js";

describe("extractOutline", () => {
  test("returns empty array when no headings exist", () => {
    expect(extractOutline("plain text without headings\nline 2")).toEqual([]);
  });

  test("parses heading levels 1-6", () => {
    const md = "# L1\n## L2\n### L3\n#### L4\n##### L5\n###### L6";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("generates GitHub-style slugs and deduplicates", () => {
    const md = "# Section One\n## Section One\n### Section One";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.anchor)).toEqual([
      "section-one",
      "section-one-1",
      "section-one-2",
    ]);
  });

  test("ignores headings inside fenced code blocks (backtick)", () => {
    const md = "# Real\n```\n# Fake\n## Fake2\n```\n## After";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.text)).toEqual(["Real", "After"]);
  });

  test("ignores headings inside fenced code blocks (tilde)", () => {
    const md = "# Real\n~~~ts\n## Fake\n~~~\n### After";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.text)).toEqual(["Real", "After"]);
  });

  test("strips inline markdown from heading text", () => {
    const md = "# **Bold** and `code` and [link](url)";
    const outline = extractOutline(md);
    expect(outline[0]?.text).toBe("Bold and code and link");
  });

  test("preserves Korean characters in anchor", () => {
    const md = "# 한글 제목\n## 두 번째 항목";
    const outline = extractOutline(md);
    expect(outline[0]?.anchor).toBe("한글-제목");
    expect(outline[1]?.anchor).toBe("두-번째-항목");
  });

  test("records line numbers (0-indexed)", () => {
    const md = "intro\n\n# First\ntext\n## Second";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.line)).toEqual([2, 4]);
  });

  test("ignores empty headings", () => {
    const md = "# \n## Valid\n###   ";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.text)).toEqual(["Valid"]);
  });

  test("handles trailing hashes (atx closed form)", () => {
    const md = "# Title ###\n## Second ##";
    const outline = extractOutline(md);
    expect(outline.map((n) => n.text)).toEqual(["Title", "Second"]);
  });
});
