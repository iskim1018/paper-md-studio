// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreviewPanel } from "../../src/components/preview-panel";
import { useFileStore } from "../../src/store/file-store";

function resetStore() {
  useFileStore.setState({ files: [], selectedFileId: null });
}

describe("PreviewPanel", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("파일 미선택 시 빈 상태를 표시한다", () => {
    render(<PreviewPanel />);
    expect(screen.getByTestId("preview-empty")).toBeTruthy();
    expect(screen.getByText("파일을 선택하세요")).toBeTruthy();
  });

  it("PDF 파일 선택 시 PdfViewer를 렌더링한다", () => {
    useFileStore.setState({
      files: [
        {
          id: "f1",
          path: "/test/doc.pdf",
          name: "doc.pdf",
          format: "pdf",
          status: "pending",
        },
      ],
      selectedFileId: "f1",
    });

    render(<PreviewPanel />);
    expect(screen.getByTestId("preview-panel")).toBeTruthy();
    expect(screen.getByText("원본 미리보기")).toBeTruthy();
    expect(screen.getByText("doc.pdf")).toBeTruthy();
    // PDF 뷰어는 로딩 상태로 시작
    expect(screen.getByText("PDF 로딩 중...")).toBeTruthy();
  });

  it("DOCX 파일 선택 시 DocxViewer를 렌더링한다", () => {
    useFileStore.setState({
      files: [
        {
          id: "f2",
          path: "/test/report.docx",
          name: "report.docx",
          format: "docx",
          status: "pending",
        },
      ],
      selectedFileId: "f2",
    });

    render(<PreviewPanel />);
    expect(screen.getByText("DOCX 로딩 중...")).toBeTruthy();
  });

  it("HWPX 파일 선택 시 HwpxViewer를 렌더링한다", () => {
    useFileStore.setState({
      files: [
        {
          id: "f3",
          path: "/test/한글문서.hwpx",
          name: "한글문서.hwpx",
          format: "hwpx",
          status: "pending",
        },
      ],
      selectedFileId: "f3",
    });

    render(<PreviewPanel />);
    expect(screen.getByText("HWPX 로딩 중...")).toBeTruthy();
  });

  it("파일 정보 토글 시 메타데이터를 표시/숨김한다", async () => {
    useFileStore.setState({
      files: [
        {
          id: "f1",
          path: "/test/doc.pdf",
          name: "doc.pdf",
          format: "pdf",
          status: "done",
          result: {
            markdown: "# Test",
            format: "pdf",
            elapsed: 123,
            imageCount: 2,
          },
        },
      ],
      selectedFileId: "f1",
    });

    render(<PreviewPanel />);
    const toggle = screen.getByTestId("meta-toggle");

    // 초기에는 메타데이터 숨김
    expect(screen.queryByText("123ms")).toBeNull();

    // 토글 클릭 → 메타데이터 표시
    await userEvent.click(toggle);
    expect(screen.getByText("123ms")).toBeTruthy();
    expect(screen.getByText("2개")).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();

    // 다시 클릭 → 숨김
    await userEvent.click(toggle);
    expect(screen.queryByText("123ms")).toBeNull();
  });

  it("에러 상태일 때 메타데이터에 오류를 표시한다", async () => {
    useFileStore.setState({
      files: [
        {
          id: "f1",
          path: "/test/doc.pdf",
          name: "doc.pdf",
          format: "pdf",
          status: "error",
          error: "파일을 읽을 수 없습니다",
        },
      ],
      selectedFileId: "f1",
    });

    render(<PreviewPanel />);
    await userEvent.click(screen.getByTestId("meta-toggle"));
    expect(screen.getByText("파일을 읽을 수 없습니다")).toBeTruthy();
  });
});
