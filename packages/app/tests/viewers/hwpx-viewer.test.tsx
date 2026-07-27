// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const freeMock = vi.fn();
const pageCountMock = vi.fn();
const renderPageSvgMock = vi.fn();
const loadHwpDocumentMock = vi.fn();
/** 텍스트 인덱스 순회의 진입점 — 인덱싱이 언제 시작되는지 관찰하는 데 쓴다. */
const getSectionCountMock = vi.fn(() => 0);

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
    getSectionCount: () => getSectionCountMock(),
  };
}

class IntersectionObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

let scrollIntoViewMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  freeMock.mockClear();
  pageCountMock.mockClear();
  renderPageSvgMock.mockClear();
  getSectionCountMock.mockClear();
  loadHwpDocumentMock.mockReset();
  // jsdom은 IntersectionObserver를 제공하지 않는다
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    IntersectionObserverStub;
  // jsdom은 Element.scrollIntoView를 구현하지 않는다
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
});

function getPageInput(): HTMLInputElement {
  return screen.getByTestId("hwpx-page-input") as HTMLInputElement;
}

describe("HwpxViewer", () => {
  it("로딩 중 메시지를 표시한다", () => {
    loadHwpDocumentMock.mockImplementation(() => new Promise(() => {}));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);
    expect(screen.getByText("HWP 로딩 중...")).toBeTruthy();
  });

  it("첫 페이지는 즉시, 나머지는 프레임을 나눠 렌더링한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => {
      expect(getPageInput().value).toBe("1");
    });

    // 문서를 여는 시점에는 첫 페이지만 렌더된다
    expect(screen.getByTestId("hwpx-page-count").textContent).toBe("3");
    expect(screen.getAllByTestId("hwpx-page")).toHaveLength(3);
    expect(renderPageSvgMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("page 1")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("page 3")).toBeTruthy();
    });
    expect(screen.getByText("page 2")).toBeTruthy();
    expect(renderPageSvgMock).toHaveBeenCalledTimes(3);
  });

  it("페이지가 많으면 보이는 구간 주변만 렌더하고 나머지는 자리표시자로 둔다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(50));
    render(<HwpxViewer filePath="/tmp/big.hwpx" />);

    await waitFor(() => {
      expect(screen.getAllByTestId("hwpx-page")).toHaveLength(50);
    });
    await waitFor(() => {
      expect(screen.getByText("page 3")).toBeTruthy();
    });

    // RENDER_AHEAD=2 → 0~2 페이지만 렌더, 나머지 47장은 자리표시자
    expect(renderPageSvgMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("page 4")).toBeNull();
    expect(screen.getAllByTestId("hwpx-page-placeholder")).toHaveLength(47);
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

  it("문서를 여는 시점에는 검색 인덱스를 만들지 않는다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));
    await waitFor(() => expect(screen.getByText("page 3")).toBeTruthy());

    expect(getSectionCountMock).not.toHaveBeenCalled();
  });

  it("검색어를 입력하면 그때 인덱스를 만든다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    screen.getByTestId("hwpx-viewer").focus();
    await userEvent.keyboard("{Meta>}f{/Meta}");
    await userEvent.type(screen.getByPlaceholderText("검색"), "설계");

    await waitFor(() => expect(getSectionCountMock).toHaveBeenCalled());
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

  it("가로 overflow가 있을 때 스크롤 위치를 가운데로 맞춘다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(1200);
    const clientSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);

    try {
      loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
      render(<HwpxViewer filePath="/tmp/wide.hwpx" />);

      await waitFor(() => {
        expect(screen.getByTestId("hwpx-page")).toBeTruthy();
      });

      const scroller = screen.getByTestId("hwpx-scroller");
      expect(scroller.scrollLeft).toBe(200);
    } finally {
      widthSpy.mockRestore();
      clientSpy.mockRestore();
    }
  });

  it("가로 overflow가 없으면 스크롤 위치를 변경하지 않는다", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(800);
    const clientSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);

    try {
      loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
      render(<HwpxViewer filePath="/tmp/narrow.hwpx" />);

      await waitFor(() => {
        expect(screen.getByTestId("hwpx-page")).toBeTruthy();
      });

      const scroller = screen.getByTestId("hwpx-scroller");
      expect(scroller.scrollLeft).toBe(0);
    } finally {
      widthSpy.mockRestore();
      clientSpy.mockRestore();
    }
  });

  it("첫 페이지에서 prev 버튼이 비활성화된다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    expect(
      (screen.getByTestId("hwpx-prev") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("hwpx-next") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("페이지가 1개뿐이면 prev/next 모두 비활성화된다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    expect(
      (screen.getByTestId("hwpx-prev") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("hwpx-next") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("next 버튼 클릭 시 다음 페이지로 scrollIntoView를 호출한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    await userEvent.click(screen.getByTestId("hwpx-next"));

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    // 호출된 element가 page-index="1"인지 확인
    const target = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(target.dataset.pageIndex).toBe("1");
    // 낙관적 업데이트로 인디케이터가 즉시 반영되어야 한다
    expect(getPageInput().value).toBe("2");
  });

  it("페이지 입력 후 Enter 시 해당 페이지로 점프한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(5));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "3");
    await userEvent.keyboard("{Enter}");

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    const target = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(target.dataset.pageIndex).toBe("2"); // 3페이지 = index 2
    expect(getPageInput().value).toBe("3");
  });

  it("범위 밖 페이지를 입력하면 현재 페이지로 복원한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "99");
    await userEvent.keyboard("{Enter}");

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(getPageInput().value).toBe("1");
  });

  it("Esc 키 입력 시 변경한 값을 현재 페이지로 복원한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    await userEvent.keyboard("{Escape}");

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(getPageInput().value).toBe("1");
  });

  it("입력 필드는 숫자가 아닌 입력을 차단한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(3));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    const input = getPageInput();
    await userEvent.clear(input);
    await userEvent.type(input, "abc");

    expect(input.value).toBe("");
  });

  it("zoom-in 버튼 클릭 시 scale이 25% 증가한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));
    expect(screen.getByTestId("hwpx-scale").textContent).toBe("100%");

    await userEvent.click(screen.getByTestId("hwpx-zoom-in"));
    expect(screen.getByTestId("hwpx-scale").textContent).toBe("125%");
  });

  it("zoom-out 버튼 클릭 시 scale이 25% 감소한다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    await userEvent.click(screen.getByTestId("hwpx-zoom-out"));
    expect(screen.getByTestId("hwpx-scale").textContent).toBe("75%");
  });

  it("scale 변경 시 scroller에 --zoom-scale CSS 변수가 적용된다", async () => {
    loadHwpDocumentMock.mockResolvedValue(createDocStub(1));
    render(<HwpxViewer filePath="/tmp/a.hwpx" />);

    await waitFor(() => expect(getPageInput().value).toBe("1"));

    await userEvent.click(screen.getByTestId("hwpx-zoom-in"));

    const scroller = screen.getByTestId("hwpx-scroller");
    // CSSStyleDeclaration.getPropertyValue로 CSS 변수 읽기
    expect(scroller.style.getPropertyValue("--zoom-scale")).toBe("1.25");
  });

  it("fit 버튼 클릭 시 SVG width 기준으로 scale 재계산", async () => {
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(1190); // (1190 - 32) / 595 ≈ 1.946 → 약 195%
    try {
      loadHwpDocumentMock.mockResolvedValue({
        free: freeMock,
        pageCount: () => 1,
        renderPageSvg: () =>
          '<svg width="595" height="842"><text>page 1</text></svg>',
      });
      render(<HwpxViewer filePath="/tmp/a.hwpx" />);

      await waitFor(() => expect(getPageInput().value).toBe("1"));
      await userEvent.click(screen.getByTestId("hwpx-fit"));

      const scaleText = screen.getByTestId("hwpx-scale").textContent ?? "";
      expect(scaleText).toMatch(/19[0-5]%/);
    } finally {
      widthSpy.mockRestore();
    }
  });
});
