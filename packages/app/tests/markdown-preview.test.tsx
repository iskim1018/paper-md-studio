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
