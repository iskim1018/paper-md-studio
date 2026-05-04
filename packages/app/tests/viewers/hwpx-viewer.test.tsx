// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const freeMock = vi.fn();
const pageCountMock = vi.fn();
const renderPageSvgMock = vi.fn();
const loadHwpDocumentMock = vi.fn();

vi.mock("../../src/lib/rhwp", () => ({
  loadHwpDocument: (path: string) => loadHwpDocumentMock(path),
}));

import { HwpxViewer } from "../../src/components/viewers/hwpx-viewer";

function createDocStub(pageCount: number) {
  return {
    free: freeMock,
    pageCount: () => {
      pageCountMock();
      return pageCount;
    },
    renderPageSvg: (page: number) => {
      renderPageSvgMock(page);
      return `<svg data-page="${page}"><text>page ${page + 1}</text></svg>`;
    },
  };
}

class IntersectionObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

beforeEach(() => {
  freeMock.mockClear();
  pageCountMock.mockClear();
  renderPageSvgMock.mockClear();
  loadHwpDocumentMock.mockReset();
  // jsdom은 IntersectionObserver를 제공하지 않는다
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    IntersectionObserverStub;
});

afterEach(() => {
  cleanup();
});

describe("HwpxViewer", () => {
  it("로딩 중 메시지를 표시한다", () => {
    loadHwpDocumentMock.mockImplementation(() => new Promise(() => {}));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);
    expect(screen.getByText("HWP 로딩 중...")).toBeTruthy();
  });

  it("로드 성공 시 모든 페이지의 SVG를 한 번에 렌더링한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => {
      expect(screen.getByTestId("hwpx-page-indicator").textContent).toBe(
        "1 / 3",
      );
    });

    expect(renderPageSvgMock).toHaveBeenCalledTimes(3);
    expect(renderPageSvgMock).toHaveBeenNthCalledWith(1, 0);
    expect(renderPageSvgMock).toHaveBeenNthCalledWith(2, 1);
    expect(renderPageSvgMock).toHaveBeenNthCalledWith(3, 2);
    expect(screen.getAllByTestId("hwpx-page")).toHaveLength(3);
    expect(screen.getByText("page 1")).toBeTruthy();
    expect(screen.getByText("page 2")).toBeTruthy();
    expect(screen.getByText("page 3")).toBeTruthy();
  });

  it("페이지가 모두 IntersectionObserver에 등록된다", async () => {
    const observeSpy = vi.fn();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      class {
        observe = observeSpy;
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn().mockReturnValue([]);
      };

    loadHwpDocumentMock.mockResolvedValue(createDocStub(2));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => {
      expect(observeSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("로드 실패 시 오류 메시지를 표시한다", async () => {
    loadHwpDocumentMock.mockRejectedValue(new Error("손상된 파일"));
    render(<HwpxViewer filePath="/tmp/bad.hwpx" />);

    await waitFor(() => {
      expect(screen.getByText("HWP 로드 실패: 손상된 파일")).toBeTruthy();
    });
  });

  it("언마운트 시 doc.free()를 호출한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
    const { unmount } = render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => {
      expect(screen.getByTestId("hwpx-page-indicator")).toBeTruthy();
    });

    unmount();
    expect(freeMock).toHaveBeenCalled();
  });
});
