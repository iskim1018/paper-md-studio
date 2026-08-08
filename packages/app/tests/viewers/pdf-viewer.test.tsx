// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDocumentMock = vi.fn();

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (opts: unknown) => getDocumentMock(opts),
}));

const readFileAsBytesMock = vi.fn();
vi.mock("../../src/lib/file-reader", () => ({
  readFileAsBytes: (path: string) => readFileAsBytesMock(path),
}));

import { PdfViewer } from "../../src/components/viewers/pdf-viewer";

class IntersectionObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

let scrollIntoViewMock: ReturnType<typeof vi.fn>;

interface FakePageOptions {
  width: number;
  height: number;
}

function createFakePage(opts: FakePageOptions) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: opts.width * scale,
      height: opts.height * scale,
    }),
    render: () => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }),
  };
}

function setupPdfDocument(pageSizes: Array<FakePageOptions>) {
  const doc = {
    numPages: pageSizes.length,
    getPage: vi.fn(async (n: number) => {
      const opts = pageSizes[n - 1];
      if (!opts) throw new Error(`page ${n} not found`);
      return createFakePage(opts);
    }),
  };
  getDocumentMock.mockReturnValue({
    promise: Promise.resolve(doc),
  });
  return doc;
}

beforeEach(() => {
  getDocumentMock.mockReset();
  readFileAsBytesMock.mockReset();
  readFileAsBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    IntersectionObserverStub;
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
  // Canvas getContext 스텁 (jsdom 기본 미지원)
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue({} as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
});

function getPageInput(): HTMLInputElement {
  return screen.getByTestId("pdf-page-input") as HTMLInputElement;
}

describe("PdfViewer", () => {
  it("로딩 중 메시지를 표시한다", () => {
    getDocumentMock.mockReturnValue({ promise: new Promise(() => {}) });
    render(<PdfViewer filePath="/tmp/a.pdf" />);
    expect(screen.getByText("PDF 로딩 중...")).toBeTruthy();
  });

  it("로드 성공 시 페이지 인디케이터와 페이지 수를 표시한다", async () => {
    setupPdfDocument([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
    render(<PdfViewer filePath="/tmp/a.pdf" />);

    await waitFor(() => {
      expect(getPageInput().value).toBe("1");
    });
    expect(screen.getByTestId("pdf-page-count").textContent).toBe("3");
    expect(screen.getAllByTestId("pdf-page")).toHaveLength(3);
  });

  it("페이지 placeholder 사이즈는 viewport × scale로 설정된다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    try {
      setupPdfDocument([{ width: 595, height: 842 }]);
      render(<PdfViewer filePath="/tmp/a.pdf" />);

      await waitFor(() => {
        expect(getPageInput().value).toBe("1");
      });

      // 초기 fit-to-width 적용: scale = (800-32)/595 ≈ 1.29
      // page width = 595 * 1.29 ≈ 768
      const page = screen.getByTestId("pdf-page");
      const w = parseFloat(page.style.width);
      expect(w).toBeGreaterThan(700);
      expect(w).toBeLessThan(800);
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("초기 fit-to-width로 100%가 아닌 scale이 표시된다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    try {
      setupPdfDocument([{ width: 595, height: 842 }]);
      render(<PdfViewer filePath="/tmp/a.pdf" />);

      await waitFor(() => {
        expect(getPageInput().value).toBe("1");
      });
      // (800-32)/595 ≈ 1.29 → 129%
      const scaleText = screen.getByTestId("pdf-scale").textContent ?? "";
      expect(scaleText).not.toBe("100%");
      expect(scaleText).toMatch(/12[8-9]%|13[0-1]%/);
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("확대 버튼 클릭 시 scale이 25% 증가한다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(595 + 32); // scale=1로 시작
    try {
      setupPdfDocument([{ width: 595, height: 842 }]);
      render(<PdfViewer filePath="/tmp/a.pdf" />);

      await waitFor(() => expect(getPageInput().value).toBe("1"));
      expect(screen.getByTestId("pdf-scale").textContent).toBe("100%");

      await userEvent.click(screen.getByTestId("pdf-zoom-in"));
      expect(screen.getByTestId("pdf-scale").textContent).toBe("125%");
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("축소 버튼 클릭 시 scale이 25% 감소한다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(595 + 32);
    try {
      setupPdfDocument([{ width: 595, height: 842 }]);
      render(<PdfViewer filePath="/tmp/a.pdf" />);

      await waitFor(() => expect(getPageInput().value).toBe("1"));

      await userEvent.click(screen.getByTestId("pdf-zoom-out"));
      expect(screen.getByTestId("pdf-scale").textContent).toBe("75%");
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("첫 페이지에서 prev 버튼이 비활성화된다", async () => {
    setupPdfDocument([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
    render(<PdfViewer filePath="/tmp/a.pdf" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    expect((screen.getByTestId("pdf-prev") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("pdf-next") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("next 버튼 클릭 시 다음 페이지로 scrollIntoView를 호출한다", async () => {
    setupPdfDocument([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
    render(<PdfViewer filePath="/tmp/a.pdf" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    await userEvent.click(screen.getByTestId("pdf-next"));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    const target = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(target.dataset.pageIndex).toBe("1");
    expect(getPageInput().value).toBe("2");
  });

  it("페이지 입력 후 Enter 시 해당 페이지로 점프한다", async () => {
    setupPdfDocument(
      Array.from({ length: 5 }, () => ({ width: 595, height: 842 })),
    );
    render(<PdfViewer filePath="/tmp/a.pdf" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "3");
    await userEvent.keyboard("{Enter}");

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    const target = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(target.dataset.pageIndex).toBe("2");
    expect(getPageInput().value).toBe("3");
  });

  it("범위 밖 페이지를 입력하면 현재 페이지로 복원한다", async () => {
    setupPdfDocument([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
    render(<PdfViewer filePath="/tmp/a.pdf" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "99");
    await userEvent.keyboard("{Enter}");

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(getPageInput().value).toBe("1");
  });

  it("가로 overflow가 있을 때 초기 스크롤을 가운데로 맞춘다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(1200);
    const clientSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);

    try {
      setupPdfDocument([{ width: 1100, height: 800 }]);
      render(<PdfViewer filePath="/tmp/wide.pdf" />);

      await waitFor(() => expect(getPageInput().value).toBe("1"));

      const scroller = screen.getByTestId("pdf-scroller");
      // (1200 - 800) / 2 = 200
      expect(scroller.scrollLeft).toBe(200);
    } finally {
      widthSpy.mockRestore();
      clientSpy.mockRestore();
    }
  });

  it("로드 실패 시 오류 메시지를 표시한다", async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.reject(new Error("손상된 파일")),
    });
    render(<PdfViewer filePath="/tmp/bad.pdf" />);

    await waitFor(() => {
      expect(screen.getByText("PDF 로드 실패: 손상된 파일")).toBeTruthy();
    });
  });
});
