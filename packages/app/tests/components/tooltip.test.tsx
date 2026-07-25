// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../../src/components/ui/tooltip";

afterEach(() => {
  cleanup();
});

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
