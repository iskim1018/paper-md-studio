// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "../../src/components/ui/tooltip";

const originalInnerWidth = window.innerWidth;
let offsetWidthSpy: { mockRestore: () => void } | null = null;

afterEach(() => {
  cleanup();
  offsetWidthSpy?.mockRestore();
  offsetWidthSpy = null;
  Object.defineProperty(window, "innerWidth", {
    value: originalInnerWidth,
    configurable: true,
    writable: true,
  });
});

interface EdgeSetup {
  readonly innerWidth: number;
  readonly triggerLeft: number;
  readonly triggerWidth: number;
  readonly bubbleWidth: number;
}

/**
 * jsdom은 레이아웃을 계산하지 않으므로 트리거 위치와 말풍선 폭을 주입한다.
 * 말풍선(.tooltip-bubble)에만 폭을 부여해 실제 측정 경로를 재현한다.
 */
function renderAtViewportEdge(setup: EdgeSetup): HTMLElement {
  Object.defineProperty(window, "innerWidth", {
    value: setup.innerWidth,
    configurable: true,
    writable: true,
  });

  offsetWidthSpy = vi
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("tooltip-bubble") ? setup.bubbleWidth : 0;
    });

  render(
    <Tooltip content="파인더에서 열기">
      <button type="button">아이콘</button>
    </Tooltip>,
  );

  const trigger = screen.getByRole("button", { name: "아이콘" });
  const wrapper = trigger.parentElement as HTMLElement;
  wrapper.getBoundingClientRect = () =>
    ({
      left: setup.triggerLeft,
      width: setup.triggerWidth,
      right: setup.triggerLeft + setup.triggerWidth,
      top: 10,
      bottom: 34,
      height: 24,
      x: setup.triggerLeft,
      y: 10,
      toJSON: () => ({}),
    }) as DOMRect;

  return trigger;
}

describe("Tooltip", () => {
  it("hover 전에는 말풍선을 렌더하지 않는다", () => {
    render(
      <Tooltip content="저장">
        <button type="button">아이콘</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "아이콘" })).toBeTruthy();
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("hover 시 body 포탈로 말풍선을 띄우고 벗어나면 제거한다", () => {
    render(
      <Tooltip content="저장">
        <button type="button">아이콘</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "아이콘" });
    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.textContent).toContain("저장");
    // Panel의 overflow:hidden에 잘리지 않도록 body 직속으로 렌더
    expect(tooltip.parentElement).toBe(document.body);
    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("키보드 포커스로도 표시된다", () => {
    render(
      <Tooltip content="저장">
        <button type="button">아이콘</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "아이콘" });
    fireEvent.focus(trigger);
    expect(screen.getByTestId("tooltip")).toBeTruthy();
    fireEvent.blur(trigger);
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("shortcut prop이 있으면 kbd로 병기한다", () => {
    render(
      <Tooltip content="저장" shortcut="⌘S">
        <button type="button">아이콘</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "아이콘" }));
    const kbd = screen.getByTestId("tooltip").querySelector("kbd");
    expect(kbd?.textContent).toBe("⌘S");
  });

  it("오른쪽 끝 버튼의 말풍선이 화면 밖으로 넘치지 않는다", () => {
    // 창 오른쪽 끝(1000px)에 붙은 트리거 + 폭 240px짜리 말풍선.
    // 중심점만 clamp하면 left=992 → 오른쪽 232px이 잘려 나간다.
    const trigger = renderAtViewportEdge({
      innerWidth: 1000,
      triggerLeft: 968,
      triggerWidth: 24,
      bubbleWidth: 240,
    });

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    const left = Number.parseFloat(screen.getByTestId("tooltip").style.left);

    expect(left + 240).toBeLessThanOrEqual(1000);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it("왼쪽 끝 버튼의 말풍선도 화면 밖으로 넘치지 않는다", () => {
    const trigger = renderAtViewportEdge({
      innerWidth: 1000,
      triggerLeft: 0,
      triggerWidth: 24,
      bubbleWidth: 240,
    });

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    const left = Number.parseFloat(screen.getByTestId("tooltip").style.left);

    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + 240).toBeLessThanOrEqual(1000);
  });

  it("여유가 있으면 트리거 중앙에 맞춘다", () => {
    const trigger = renderAtViewportEdge({
      innerWidth: 1000,
      triggerLeft: 400,
      triggerWidth: 24,
      bubbleWidth: 100,
    });

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    const left = Number.parseFloat(screen.getByTestId("tooltip").style.left);

    // 중앙 412 - 폭 절반 50 = 362
    expect(left).toBe(362);
  });

  it("스크린리더에는 노출되지 않는다 (aria-hidden)", () => {
    render(
      <Tooltip content="저장">
        <button type="button">아이콘</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "아이콘" }));
    expect(screen.getByTestId("tooltip").getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
