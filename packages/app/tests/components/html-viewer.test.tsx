// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const convertFileToHtml = vi.fn();
vi.mock("../../src/lib/converter", () => ({
  convertFileToHtml: (path: string) => convertFileToHtml(path),
}));

import { HtmlViewer } from "../../src/components/viewers/html-viewer";

describe("HtmlViewer", () => {
  afterEach(() => {
    cleanup();
    convertFileToHtml.mockReset();
  });

  it("추출된 본문을 sanitize하여 렌더링한다", async () => {
    // Arrange: script가 섞인 사이드카 --html 출력
    convertFileToHtml.mockResolvedValue(
      "<h1>추출된 제목</h1><p>본문 문단</p><script>alert(1)</script>",
    );

    // Act
    render(<HtmlViewer filePath="https://example.com/post" />);

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId("html-viewer")).toBeTruthy();
    });
    expect(screen.getByText("추출된 제목")).toBeTruthy();
    expect(screen.getByText("본문 문단")).toBeTruthy();
    expect(screen.getByTestId("html-viewer").innerHTML.includes("script")).toBe(
      false,
    );
    expect(convertFileToHtml).toHaveBeenCalledWith("https://example.com/post");
  });

  it("로딩 중 상태를 표시한다", () => {
    convertFileToHtml.mockReturnValue(new Promise(() => undefined));

    render(<HtmlViewer filePath="https://example.com/slow" />);

    expect(screen.getByTestId("html-viewer-loading")).toBeTruthy();
    expect(screen.getByText("본문을 불러오는 중...")).toBeTruthy();
  });

  it("실패 시 한국어 에러 메시지를 표시한다", async () => {
    convertFileToHtml.mockRejectedValue(
      new Error("URL을 가져오지 못했습니다: 호스트 해석 실패"),
    );

    render(<HtmlViewer filePath="https://없는호스트.example" />);

    await waitFor(() => {
      expect(screen.getByTestId("html-viewer-error")).toBeTruthy();
    });
    expect(screen.getByText(/URL을 가져오지 못했습니다/)).toBeTruthy();
  });
});
