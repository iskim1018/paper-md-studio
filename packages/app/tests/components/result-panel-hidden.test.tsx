// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

const retry = vi.fn();
vi.mock("../../src/store/convert-queue-store", () => ({
  useConvertQueueStore: (selector: (s: unknown) => unknown) =>
    selector({ retry }),
}));

import { ResultPanel } from "../../src/components/result-panel";
import { useFileStore } from "../../src/store/file-store";

beforeEach(() => {
  useFileStore.getState().clearFiles();
  retry.mockClear();
});

afterEach(() => {
  cleanup();
});

interface SeedOptions {
  readonly hiddenExcluded?: { sheets: number; rows: number; cols: number };
  readonly warnings?: Array<string>;
  readonly includeHidden?: boolean;
}

/** 변환이 끝난 엑셀 파일 하나를 스토어에 만들어 선택 상태로 둔다. */
function seedXlsx(options: SeedOptions = {}): string {
  const store = useFileStore.getState();
  store.addFiles(["/docs/재고.xlsx"]);
  const id = useFileStore.getState().files[0]?.id;
  if (!id) throw new Error("파일 추가 실패");

  if (options.includeHidden) {
    store.setIncludeHidden(id, true);
  }
  store.updateFile(id, {
    status: "done",
    result: {
      markdown: "| 품목 |\n| --- |",
      format: "xlsx",
      elapsed: 12,
      imageCount: 0,
      outputPath: "/docs/재고.md",
      ...(options.warnings ? { warnings: options.warnings } : {}),
      ...(options.hiddenExcluded
        ? { hiddenExcluded: options.hiddenExcluded }
        : {}),
    },
  });
  return id;
}

/**
 * 숨긴 항목은 파일을 열기 전엔 있는지조차 알 수 없어, 변환 전에 묻는 대신
 * 결과 배너에서 곧바로 되돌릴 수 있게 한다.
 */
describe("ResultPanel 숨김 항목 되돌리기", () => {
  it("제외된 숨김 항목이 있으면 포함 버튼을 띄운다", () => {
    seedXlsx({
      hiddenExcluded: { sheets: 0, rows: 0, cols: 1 },
      warnings: ['시트 "재고"의 숨겨진 열 1개를 제외했습니다.'],
    });

    render(<ResultPanel />);

    expect(screen.getByTestId("toggle-hidden-btn").textContent).toContain(
      "포함해 다시 변환",
    );
  });

  it("숨긴 항목이 없는 파일에는 배너를 띄우지 않는다 — 평소 UI 비용 0", () => {
    seedXlsx();

    render(<ResultPanel />);

    expect(screen.queryByTestId("conversion-warnings")).toBeNull();
    expect(screen.queryByTestId("toggle-hidden-btn")).toBeNull();
  });

  it("버튼을 누르면 포함으로 바꾸고 재변환을 요청한다", () => {
    const id = seedXlsx({
      hiddenExcluded: { sheets: 1, rows: 0, cols: 0 },
      warnings: ["숨겨진 시트 1개를 제외했습니다: 내부검토"],
    });

    render(<ResultPanel />);
    fireEvent.click(screen.getByTestId("toggle-hidden-btn"));

    const file = useFileStore.getState().files.find((f) => f.id === id);
    expect(file?.includeHidden).toBe(true);
    expect(retry).toHaveBeenCalledWith({ id, path: "/docs/재고.xlsx" });
  });

  it("포함 상태에서는 되돌리기 버튼과 안내를 보여준다", () => {
    seedXlsx({ includeHidden: true });

    render(<ResultPanel />);

    expect(screen.getByTestId("conversion-warnings").textContent).toContain(
      "숨긴 시트·행·열을 포함해 변환했습니다",
    );
    expect(screen.getByTestId("toggle-hidden-btn").textContent).toContain(
      "빼고 다시 변환",
    );
  });

  it("포함 상태에서 버튼을 누르면 다시 제외로 되돌린다", () => {
    const id = seedXlsx({ includeHidden: true });

    render(<ResultPanel />);
    fireEvent.click(screen.getByTestId("toggle-hidden-btn"));

    const file = useFileStore.getState().files.find((f) => f.id === id);
    expect(file?.includeHidden).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("재변환 중에는 버튼을 비활성화해 중복 요청을 막는다", () => {
    const id = seedXlsx({ hiddenExcluded: { sheets: 0, rows: 2, cols: 0 } });
    useFileStore.getState().updateFile(id, { status: "converting" });

    render(<ResultPanel />);

    const button = screen.getByTestId<HTMLButtonElement>("toggle-hidden-btn");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("다시 변환 중");
  });
});
