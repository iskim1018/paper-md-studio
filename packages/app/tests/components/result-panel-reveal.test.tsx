// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revealItemInDirMock = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (path: string) => revealItemInDirMock(path),
}));

import { ResultPanel } from "../../src/components/result-panel";
import { useFileStore } from "../../src/store/file-store";

beforeEach(() => {
  revealItemInDirMock.mockReset().mockResolvedValue(undefined);
  useFileStore.getState().clearFiles();
});

afterEach(() => {
  cleanup();
});

/** 변환이 끝난 파일 하나를 스토어에 만들어 선택 상태로 둔다. */
function seedConvertedFile(outputPath: string): void {
  const store = useFileStore.getState();
  store.addFiles(["/docs/문서.hwpx"]);
  const id = useFileStore.getState().files[0]?.id;
  if (!id) throw new Error("파일 추가 실패");
  store.updateFile(id, {
    status: "done",
    result: {
      markdown: "# 제목",
      format: "hwpx",
      elapsed: 12,
      imageCount: 0,
      outputPath,
    },
  });
}

describe("ResultPanel 폴더 열기", () => {
  it("결과 파일이 선택된 상태로 폴더를 연다", async () => {
    seedConvertedFile("/out/md/문서.md");
    render(<ResultPanel />);

    await userEvent.click(screen.getByTestId("open-folder-btn"));

    // 폴더 경로가 아니라 파일 경로를 넘겨야 Finder에서 파일이 선택된다
    expect(revealItemInDirMock).toHaveBeenCalledWith("/out/md/문서.md");
  });

  it("파일이 사라져 열지 못하면 사유를 화면에 보여준다", async () => {
    revealItemInDirMock.mockRejectedValue(new Error("not found"));
    seedConvertedFile("/out/md/문서.md");
    render(<ResultPanel />);

    await userEvent.click(screen.getByTestId("open-folder-btn"));

    // 조용히 삼키면 "눌러도 아무 일 없는" 버튼이 된다
    const error = await screen.findByTestId("save-error");
    expect(error.textContent).toContain("폴더를 열 수 없습니다");
  });
});
