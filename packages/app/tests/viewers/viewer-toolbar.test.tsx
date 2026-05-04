// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewerToolbar } from "../../src/components/viewers/viewer-toolbar";

afterEach(() => {
  cleanup();
});

interface RenderOpts {
  currentPage?: number;
  pageCount?: number;
  scale?: number;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  onPageJump?: ReturnType<typeof vi.fn>;
  onZoomIn?: ReturnType<typeof vi.fn>;
  onZoomOut?: ReturnType<typeof vi.fn>;
  onFitToWidth?: ReturnType<typeof vi.fn>;
}

function renderToolbar(opts: RenderOpts = {}) {
  const handlers = {
    onPageJump: opts.onPageJump ?? vi.fn(),
    onZoomIn: opts.onZoomIn ?? vi.fn(),
    onZoomOut: opts.onZoomOut ?? vi.fn(),
    onFitToWidth: opts.onFitToWidth ?? vi.fn(),
  };
  render(
    <ViewerToolbar
      currentPage={opts.currentPage ?? 0}
      pageCount={opts.pageCount ?? 3}
      scale={opts.scale ?? 1}
      testIdPrefix="test"
      canZoomIn={opts.canZoomIn ?? true}
      canZoomOut={opts.canZoomOut ?? true}
      {...handlers}
    />,
  );
  return handlers;
}

function getInput(): HTMLInputElement {
  return screen.getByTestId("test-page-input") as HTMLInputElement;
}

describe("ViewerToolbar", () => {
  it("currentPage + 1을 입력 필드에 표시한다", () => {
    renderToolbar({ currentPage: 2, pageCount: 5 });
    expect(getInput().value).toBe("3");
    expect(screen.getByTestId("test-page-count").textContent).toBe("5");
  });

  it("scale을 백분율로 표시한다", () => {
    renderToolbar({ scale: 1.25 });
    expect(screen.getByTestId("test-scale").textContent).toBe("125%");
  });

  it("prev 버튼 클릭 시 onPageJump(-1)을 호출한다", async () => {
    const handlers = renderToolbar({ currentPage: 2 });
    await userEvent.click(screen.getByTestId("test-prev"));
    expect(handlers.onPageJump).toHaveBeenCalledWith(1);
  });

  it("next 버튼 클릭 시 onPageJump(+1)을 호출한다", async () => {
    const handlers = renderToolbar({ currentPage: 0, pageCount: 3 });
    await userEvent.click(screen.getByTestId("test-next"));
    expect(handlers.onPageJump).toHaveBeenCalledWith(1);
  });

  it("첫 페이지에서 prev가 비활성화된다", () => {
    renderToolbar({ currentPage: 0 });
    expect(
      (screen.getByTestId("test-prev") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("마지막 페이지에서 next가 비활성화된다", () => {
    renderToolbar({ currentPage: 2, pageCount: 3 });
    expect(
      (screen.getByTestId("test-next") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("zoom-in 버튼 클릭 시 onZoomIn을 호출한다", async () => {
    const handlers = renderToolbar();
    await userEvent.click(screen.getByTestId("test-zoom-in"));
    expect(handlers.onZoomIn).toHaveBeenCalled();
  });

  it("zoom-out 버튼 클릭 시 onZoomOut을 호출한다", async () => {
    const handlers = renderToolbar();
    await userEvent.click(screen.getByTestId("test-zoom-out"));
    expect(handlers.onZoomOut).toHaveBeenCalled();
  });

  it("fit 버튼 클릭 시 onFitToWidth를 호출한다", async () => {
    const handlers = renderToolbar();
    await userEvent.click(screen.getByTestId("test-fit"));
    expect(handlers.onFitToWidth).toHaveBeenCalled();
  });

  it("canZoomIn=false면 zoom-in이 비활성화", () => {
    renderToolbar({ canZoomIn: false });
    expect(
      (screen.getByTestId("test-zoom-in") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("canZoomOut=false면 zoom-out이 비활성화", () => {
    renderToolbar({ canZoomOut: false });
    expect(
      (screen.getByTestId("test-zoom-out") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("페이지 입력 후 Enter 시 onPageJump 호출", async () => {
    const handlers = renderToolbar({ pageCount: 10 });
    const input = getInput();
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await userEvent.keyboard("{Enter}");
    expect(handlers.onPageJump).toHaveBeenCalledWith(4); // 0-based
  });

  it("범위 밖 입력은 onPageJump 호출 없이 복원", async () => {
    const handlers = renderToolbar({ pageCount: 3, currentPage: 0 });
    const input = getInput();
    await userEvent.clear(input);
    await userEvent.type(input, "99");
    await userEvent.keyboard("{Enter}");
    expect(handlers.onPageJump).not.toHaveBeenCalled();
    expect(getInput().value).toBe("1");
  });

  it("Esc 키 입력 시 onPageJump 호출 없이 복원", async () => {
    const handlers = renderToolbar({ pageCount: 3, currentPage: 0 });
    const input = getInput();
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    await userEvent.keyboard("{Escape}");
    expect(handlers.onPageJump).not.toHaveBeenCalled();
    expect(getInput().value).toBe("1");
  });

  it("입력 필드는 숫자가 아닌 문자를 차단한다", async () => {
    renderToolbar();
    const input = getInput();
    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    expect(input.value).toBe("");
  });
});
