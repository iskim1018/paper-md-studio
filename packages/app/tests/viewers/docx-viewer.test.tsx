// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __TEST_MARKERS__ } from "../../src/lib/docx-page-fields";

const { PAGE_MARKER, NUMPAGES_MARKER } = __TEST_MARKERS__;

const renderAsyncMock = vi.fn();

vi.mock("docx-preview", () => ({
  renderAsync: (
    data: ArrayBuffer,
    container: HTMLElement,
    styleContainer: HTMLElement | undefined,
    options: Record<string, unknown>,
  ) => renderAsyncMock(data, container, styleContainer, options),
}));

const readFileAsBytesMock = vi.fn();
vi.mock("../../src/lib/file-reader", () => ({
  readFileAsBytes: (path: string) => readFileAsBytesMock(path),
}));

/**
 * preprocessDocxPageFields가 jszip.loadAsync로 처리할 수 있도록
 * 최소한의 유효한 docx 바이트를 반환. 헤더/푸터가 없으므로 no-op.
 */
async function buildMinimalDocxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", "<root/>");
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return new Uint8Array(ab);
}

import { DocxViewer } from "../../src/components/viewers/docx-viewer";

class IntersectionObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

let scrollIntoViewMock: ReturnType<typeof vi.fn>;

function setupRenderAsyncWithPages(pageCount: number) {
  renderAsyncMock.mockImplementation(async (_data, container) => {
    const pages = Array.from({ length: pageCount }, (_, i) => {
      const section = document.createElement("section");
      section.className = "docx";
      section.textContent = `page ${i + 1}`;
      return section;
    });
    container.replaceChildren(...pages);
  });
}

beforeEach(async () => {
  renderAsyncMock.mockReset();
  readFileAsBytesMock.mockReset();
  // preprocessDocxPageFields가 정상 처리할 수 있는 최소 docx 제공
  readFileAsBytesMock.mockResolvedValue(await buildMinimalDocxBytes());
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    IntersectionObserverStub;
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
});

function getPageInput(): HTMLInputElement {
  return screen.getByTestId("docx-page-input") as HTMLInputElement;
}

describe("DocxViewer", () => {
  it("로딩 중 메시지를 표시한다", () => {
    renderAsyncMock.mockImplementation(() => new Promise(() => {}));
    render(<DocxViewer filePath="/tmp/a.docx" />);
    expect(screen.getByText("DOCX 로딩 중...")).toBeTruthy();
  });

  it("로드 성공 시 페이지 인디케이터와 페이지 수를 표시한다", async () => {
    setupRenderAsyncWithPages(3);
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => {
      expect(getPageInput().value).toBe("1");
    });
    expect(screen.getByTestId("docx-page-count").textContent).toBe("3");
    expect(renderAsyncMock).toHaveBeenCalled();
  });

  it("renderAsync에 inWrapper:false와 breakPages:true를 전달한다", async () => {
    setupRenderAsyncWithPages(1);
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const options = renderAsyncMock.mock.calls[0]?.[3];
    expect(options).toMatchObject({
      inWrapper: false,
      breakPages: true,
    });
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

    setupRenderAsyncWithPages(2);
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => {
      expect(observeSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("로드 실패 시 오류 메시지를 표시한다", async () => {
    renderAsyncMock.mockRejectedValue(new Error("손상된 파일"));
    render(<DocxViewer filePath="/tmp/bad.docx" />);

    await waitFor(() => {
      expect(screen.getByText("DOCX 로드 실패: 손상된 파일")).toBeTruthy();
    });
  });

  it("가로 overflow가 있을 때 스크롤 위치를 가운데로 맞춘다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(1200);
    const clientSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);

    try {
      setupRenderAsyncWithPages(1);
      render(<DocxViewer filePath="/tmp/wide.docx" />);

      await waitFor(() => expect(getPageInput().value).toBe("1"));

      const scroller = screen.getByTestId("docx-scroller");
      expect(scroller.scrollLeft).toBe(200);
    } finally {
      widthSpy.mockRestore();
      clientSpy.mockRestore();
    }
  });

  it("첫 페이지에서 prev 버튼이 비활성화된다", async () => {
    setupRenderAsyncWithPages(3);
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    expect(
      (screen.getByTestId("docx-prev") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("docx-next") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("next 버튼 클릭 시 다음 페이지로 scrollIntoView를 호출한다", async () => {
    setupRenderAsyncWithPages(3);
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    await userEvent.click(screen.getByTestId("docx-next"));

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    const target = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(target.dataset.pageIndex).toBe("1");
    expect(getPageInput().value).toBe("2");
  });

  it("페이지 입력 후 Enter 시 해당 페이지로 점프한다", async () => {
    setupRenderAsyncWithPages(5);
    render(<DocxViewer filePath="/tmp/a.docx" />);

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

  it("렌더 후 헤더/푸터의 페이지 번호 마커를 실제 번호로 교체한다", async () => {
    renderAsyncMock.mockImplementation(async (_data, container) => {
      const sections = [1, 2, 3].map(() => {
        const section = document.createElement("section");
        section.className = "docx";
        const footer = document.createElement("footer");
        footer.textContent = `Page ${PAGE_MARKER} / ${NUMPAGES_MARKER}`;
        section.appendChild(footer);
        return section;
      });
      container.replaceChildren(...sections);
    });
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const footers = screen
      .getByTestId("docx-viewer")
      .querySelectorAll("section.docx footer");
    expect(footers[0]?.textContent).toBe("Page 1 / 3");
    expect(footers[1]?.textContent).toBe("Page 2 / 3");
    expect(footers[2]?.textContent).toBe("Page 3 / 3");
  });

  it("범위 밖 페이지를 입력하면 현재 페이지로 복원한다", async () => {
    setupRenderAsyncWithPages(3);
    render(<DocxViewer filePath="/tmp/a.docx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "99");
    await userEvent.keyboard("{Enter}");

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(getPageInput().value).toBe("1");
  });
});
