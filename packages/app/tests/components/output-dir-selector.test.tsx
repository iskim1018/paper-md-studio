// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openPathMock = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (path: string) => openPathMock(path),
}));

import { OutputDirSelector } from "../../src/components/output-dir-selector";
import { useFileStore } from "../../src/store/file-store";
import { useSettingsStore } from "../../src/store/settings-store";

function getOpenButton(): HTMLButtonElement {
  return screen.getByTestId("output-dir-open-btn") as HTMLButtonElement;
}

beforeEach(() => {
  openPathMock.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ outputDir: null });
  useFileStore.getState().clearFiles();
});

afterEach(() => {
  cleanup();
});

describe("OutputDirSelector 폴더 열기", () => {
  it("출력 폴더가 지정돼 있으면 그 폴더를 연다", async () => {
    useSettingsStore.setState({ outputDir: "/out/md" });
    render(<OutputDirSelector />);

    await userEvent.click(getOpenButton());

    expect(openPathMock).toHaveBeenCalledWith("/out/md");
  });

  it("원본 폴더 모드면 선택된 파일이 있는 폴더를 연다", async () => {
    useFileStore.getState().addFiles(["/docs/보고서/문서.hwpx"]);
    render(<OutputDirSelector />);

    await userEvent.click(getOpenButton());

    expect(openPathMock).toHaveBeenCalledWith("/docs/보고서");
  });

  it("열 곳을 특정할 수 없으면 버튼이 비활성화된다", () => {
    render(<OutputDirSelector />);

    const button = getOpenButton();
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("파일을 선택하면");
  });

  it("폴더를 열지 못하면 사유를 화면에 보여준다", async () => {
    openPathMock.mockRejectedValue(new Error("no such directory"));
    useSettingsStore.setState({ outputDir: "/사라진/폴더" });
    render(<OutputDirSelector />);

    await userEvent.click(getOpenButton());

    expect(openPathMock).toHaveBeenCalledWith("/사라진/폴더");
    // 조용히 삼키면 "눌러도 아무 일 없는" 버튼이 된다
    const error = await screen.findByTestId("output-dir-error");
    expect(error.textContent).toContain("no such directory");
    // 버튼은 계속 눌러볼 수 있는 상태로 남는다
    expect(getOpenButton().disabled).toBe(false);
  });
});
