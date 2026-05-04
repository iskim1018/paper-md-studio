// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PanelToggles } from "../../src/components/panel-toggles";
import { useLayoutStore } from "../../src/store/layout-store";

function resetStore() {
  useLayoutStore.setState({
    isResultFullscreen: false,
    showFileList: true,
    showPreview: true,
    showResult: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("PanelToggles", () => {
  it("3개 토글 버튼을 모두 렌더한다", () => {
    render(<PanelToggles />);
    expect(screen.getByTestId("toggle-filelist")).toBeTruthy();
    expect(screen.getByTestId("toggle-preview")).toBeTruthy();
    expect(screen.getByTestId("toggle-result")).toBeTruthy();
  });

  it("active 패널의 aria-pressed가 true", () => {
    render(<PanelToggles />);
    expect(
      screen.getByTestId("toggle-filelist").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("FileList 토글 클릭 시 store 상태가 반전된다", async () => {
    render(<PanelToggles />);
    await userEvent.click(screen.getByTestId("toggle-filelist"));
    expect(useLayoutStore.getState().showFileList).toBe(false);
    expect(
      screen.getByTestId("toggle-filelist").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("FileList 단독 visible 상태에서 좌측 토글만 비활성화된다", () => {
    useLayoutStore.setState({
      showFileList: true,
      showPreview: false,
      showResult: false,
    });
    render(<PanelToggles />);
    expect(
      (screen.getByTestId("toggle-filelist") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("toggle-preview") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("toggle-result") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("Preview 단독 visible 상태에서 중앙 토글만 비활성화된다", () => {
    useLayoutStore.setState({
      showFileList: false,
      showPreview: true,
      showResult: false,
    });
    render(<PanelToggles />);
    expect(
      (screen.getByTestId("toggle-preview") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("toggle-filelist") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("toggle-result") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("Result 단독 visible 상태에서 우측 토글만 비활성화된다", () => {
    useLayoutStore.setState({
      showFileList: false,
      showPreview: false,
      showResult: true,
    });
    render(<PanelToggles />);
    expect(
      (screen.getByTestId("toggle-result") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("toggle-filelist") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("toggle-preview") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("2개 이상 visible이면 모든 토글이 활성화된다", () => {
    useLayoutStore.setState({
      showFileList: false,
      showPreview: true,
      showResult: true,
    });
    render(<PanelToggles />);
    expect(
      (screen.getByTestId("toggle-filelist") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("toggle-preview") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("toggle-result") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("isResultFullscreen 중에는 모든 토글이 비활성화된다", () => {
    useLayoutStore.setState({ isResultFullscreen: true });
    render(<PanelToggles />);
    expect(
      (screen.getByTestId("toggle-filelist") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("toggle-preview") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("toggle-result") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
