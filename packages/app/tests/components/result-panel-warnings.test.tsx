// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

import { ResultPanel } from "../../src/components/result-panel";
import { useFileStore } from "../../src/store/file-store";

beforeEach(() => {
  useFileStore.getState().clearFiles();
});

afterEach(() => {
  cleanup();
});

/** 변환이 끝난 파일 하나를 스토어에 만들어 선택 상태로 둔다. */
function seedConvertedFile(warnings?: Array<string>): void {
  const store = useFileStore.getState();
  store.addFiles(["/docs/스캔본.pdf"]);
  const id = useFileStore.getState().files[0]?.id;
  if (!id) throw new Error("파일 추가 실패");
  store.updateFile(id, {
    status: "done",
    result: {
      markdown: "",
      format: "pdf",
      elapsed: 12,
      imageCount: 0,
      outputPath: "/docs/스캔본.md",
      ...(warnings ? { warnings } : {}),
    },
  });
}

describe("ResultPanel 변환 경고", () => {
  it("경고가 있으면 결과 위에 표시한다 (스캔 PDF가 조용히 비지 않도록)", () => {
    // Arrange
    const warning =
      "PDF에서 추출할 텍스트를 찾지 못했습니다. 스캔한 문서라면 글자를 추출하는 데 문자 인식(OCR)이 필요합니다.";
    seedConvertedFile([warning]);

    // Act
    render(<ResultPanel />);

    // Assert
    expect(screen.getByTestId("conversion-warnings").textContent).toContain(
      "추출할 텍스트를 찾지 못했습니다",
    );
  });

  it("경고가 없으면 아무것도 표시하지 않는다", () => {
    // Arrange
    seedConvertedFile();

    // Act
    render(<ResultPanel />);

    // Assert
    expect(screen.queryByTestId("conversion-warnings")).toBeNull();
  });
});
