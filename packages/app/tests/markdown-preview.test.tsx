// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURI(path)}`,
}));

import { MarkdownPreview } from "../src/components/editor/markdown-preview";

describe("MarkdownPreview image src rewriting", () => {
  afterEach(() => cleanup());

  it("rewrites relative image src to Tauri asset URL when basePath is given", () => {
    const md = "![alt](./문서_images/foo.png)";
    render(
      <MarkdownPreview markdown={md} basePath="/Users/me/Documents/문서.md" />,
    );
    const img = screen.getByAltText("alt") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      `asset://localhost/${encodeURI("/Users/me/Documents/문서_images/foo.png")}`,
    );
  });

  it("leaves http(s) image src untouched", () => {
    const md = "![remote](https://example.com/foo.png)";
    render(
      <MarkdownPreview markdown={md} basePath="/Users/me/Documents/문서.md" />,
    );
    const img = screen.getByAltText("remote") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://example.com/foo.png");
  });

  it("does not rewrite link href to asset URL", () => {
    const md = "[link](./other.md)";
    render(
      <MarkdownPreview markdown={md} basePath="/Users/me/Documents/note.md" />,
    );
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("./other.md");
  });

  it("renders relative image src as-is when basePath is missing", () => {
    const md = "![alt](./images/foo.png)";
    render(<MarkdownPreview markdown={md} />);
    const img = screen.getByAltText("alt") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("./images/foo.png");
  });
});

describe("MarkdownPreview 처리 횟수", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("같은 Markdown 으로 다시 그려도 문서를 다시 처리하지 않는다", async () => {
    // 검색 입력·스토어 갱신마다 2.7MB 문서를 다시 파싱하던 회귀를 막는다
    const markdownHtml = await import("../src/lib/markdown-html");
    const spy = vi.spyOn(markdownHtml, "renderMarkdownToHtml");
    const { rerender } = render(<MarkdownPreview markdown="# 제목" />);
    rerender(<MarkdownPreview markdown="# 제목" />);
    rerender(<MarkdownPreview markdown="# 제목" />);

    expect(spy).toHaveBeenCalledTimes(1);

    rerender(<MarkdownPreview markdown="# 바뀐 제목" />);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading").textContent).toBe("바뀐 제목");
  });

  it("큰 표는 행 묶음으로 나뉘어 붙는다", () => {
    const lines = ["| 번호 |", "| --- |"];
    for (let r = 0; r < 450; r += 1) lines.push(`| ${r} |`);

    render(<MarkdownPreview markdown={lines.join("\n")} />);

    const content = screen.getByTestId("markdown-preview-content");
    expect(content.querySelectorAll(".table-chunk").length).toBe(5);
    expect(content.querySelectorAll("tbody tr").length).toBe(450);
  });
});
