// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { afterEach, describe, expect, it } from "vitest";
import { ResizeHandle } from "../../src/components/ui/resize-handle";

afterEach(() => {
  cleanup();
});

/** 핸들은 PanelGroup 컨텍스트 안에서만 렌더된다. */
function renderInGroup() {
  return render(
    <PanelGroup direction="horizontal">
      <Panel id="a" order={1} defaultSize={50}>
        A
      </Panel>
      <ResizeHandle />
      <Panel id="b" order={2} defaultSize={50}>
        B
      </Panel>
    </PanelGroup>,
  );
}

describe("ResizeHandle", () => {
  it("조작 가능함을 알리는 그립 점을 평상시에도 노출한다", () => {
    renderInGroup();

    const handle = screen.getByTestId("panel-resize-handle");
    const grip = handle.querySelector(".panel-resize-grip");

    expect(grip).not.toBeNull();
    expect(grip?.querySelectorAll("span")).toHaveLength(3);
    // 그립은 장식이므로 스크린리더에서 제외한다
    expect(grip?.getAttribute("aria-hidden")).toBe("true");
  });

  it("스크린리더·키보드 사용자를 위한 역할과 레이블을 갖는다", () => {
    renderInGroup();

    const handle = screen.getByTestId("panel-resize-handle");

    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-label")).toBe("패널 너비 조절");
    // 화살표 키로 조절할 수 있어야 하므로 포커스 가능해야 한다
    expect(handle.tabIndex).toBe(0);
  });

  it("상태별 스타일을 걸 수 있도록 상태 속성이 노출된다", () => {
    renderInGroup();

    const handle = screen.getByTestId("panel-resize-handle");

    expect(handle.className).toContain("panel-resize-handle");
    expect(handle.getAttribute("data-resize-handle-state")).toBe("inactive");
  });
});
