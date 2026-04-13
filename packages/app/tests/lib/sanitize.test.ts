// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeViewerHtml } from "../../src/lib/sanitize";

describe("sanitizeViewerHtml", () => {
  it("preserves img tags with data: URIs (HWPX inline images)", () => {
    const html =
      '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="test"></p>';
    const result = sanitizeViewerHtml(html);
    expect(result).toContain("<img");
    expect(result).toContain("data:image/png;base64");
  });

  it("preserves img tags with blob: URIs (DOCX mammoth images)", () => {
    const html =
      '<p><img src="blob:http://localhost/abcd-1234" alt="test"></p>';
    const result = sanitizeViewerHtml(html);
    expect(result).toContain("<img");
    expect(result).toContain("blob:");
  });

  it("strips javascript: URIs to prevent XSS", () => {
    const html = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeViewerHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("strips <script> tags", () => {
    const html = "<p>safe</p><script>alert(1)</script>";
    const result = sanitizeViewerHtml(html);
    expect(result).not.toContain("<script");
    expect(result).toContain("<p>safe</p>");
  });

  it("preserves basic formatting and tables", () => {
    const html =
      "<h1>제목</h1><table><tr><td>셀</td></tr></table><strong>굵게</strong>";
    const result = sanitizeViewerHtml(html);
    expect(result).toContain("<h1>제목</h1>");
    expect(result).toContain("<table>");
    expect(result).toContain("<strong>굵게</strong>");
  });
});
