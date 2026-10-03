// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const convertFileToHtml = vi.fn();
vi.mock("../../src/lib/converter", () => ({
  convertFileToHtml: (path: string, options?: unknown) =>
    convertFileToHtml(path, options),
}));

import { XlsxViewer } from "../../src/components/viewers/xlsx-viewer";

beforeEach(() => {
  convertFileToHtml.mockReset();
});

afterEach(() => {
  cleanup();
});

const TWO_SHEETS = `<h2>1월</h2><table><tr><th>항목</th><th>값</th></tr><tr><td>매출</td><td>100</td></tr></table><h2>2월</h2><table><tr><th>항목</th><th>값</th></tr></table>`;

/**
 * 엑셀은 원본 뷰어가 없으면 "무엇이 빠졌는지" 대조할 방법이 없다.
 * 그래서 이 뷰어는 숨긴 항목까지 포함해 불러오되 흐리게 표시한다.
 */
describe("XlsxViewer", () => {
  it("숨긴 항목까지 포함해 원본을 불러온다", async () => {
    convertFileToHtml.mockResolvedValue("<h2>재고</h2><table></table>");

    render(<XlsxViewer filePath="/docs/재고.xlsx" />);

    await waitFor(() => {
      expect(convertFileToHtml).toHaveBeenCalledWith("/docs/재고.xlsx", {
        includeHidden: true,
      });
    });
  });

  it("시트 수를 알려주고 표를 렌더한다", async () => {
    convertFileToHtml.mockResolvedValue(TWO_SHEETS);

    render(<XlsxViewer filePath="/docs/월별.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-viewer").textContent).toContain(
        "시트 2개",
      );
    });
    expect(
      screen.getByTestId("xlsx-scroller").querySelectorAll("table").length,
    ).toBe(2);
  });

  it("시트가 여러 개면 이동 탭을 둔다", async () => {
    convertFileToHtml.mockResolvedValue(TWO_SHEETS);

    render(<XlsxViewer filePath="/docs/월별.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-sheet-tabs")).toBeTruthy();
    });
    const tabs = screen
      .getByTestId("xlsx-sheet-tabs")
      .querySelectorAll("button");
    expect([...tabs].map((t) => t.textContent)).toEqual(["1월", "2월"]);
  });

  it("시트가 하나면 탭을 만들지 않는다 — 군더더기 제거", async () => {
    convertFileToHtml.mockResolvedValue("<h2>재고</h2><table></table>");

    render(<XlsxViewer filePath="/docs/재고.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-viewer")).toBeTruthy();
    });
    expect(screen.queryByTestId("xlsx-sheet-tabs")).toBeNull();
  });

  it("숨긴 자리가 있으면 범례를 보여준다", async () => {
    convertFileToHtml.mockResolvedValue(
      '<h2>재고</h2><table><tr><td>보임</td><td class="xlsx-hidden-col">숨김</td></tr></table>',
    );

    render(<XlsxViewer filePath="/docs/재고.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-hidden-legend").textContent).toContain(
        "숨겨진 행·열",
      );
    });
  });

  it("숨긴 자리가 없으면 범례를 띄우지 않는다", async () => {
    convertFileToHtml.mockResolvedValue(
      "<h2>재고</h2><table><tr><td>보임</td></tr></table>",
    );

    render(<XlsxViewer filePath="/docs/재고.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-viewer")).toBeTruthy();
    });
    expect(screen.queryByTestId("xlsx-hidden-legend")).toBeNull();
  });

  it("실패하면 원인을 보여준다", async () => {
    convertFileToHtml.mockRejectedValue(new Error("파일이 손상되었습니다"));

    render(<XlsxViewer filePath="/docs/깨진.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-viewer-error").textContent).toContain(
        "파일이 손상되었습니다",
      );
    });
  });
});

describe("XlsxViewer 큰 시트", () => {
  it("행이 많은 시트는 행 묶음으로 나눠 그리고, 숨김 범례 집계는 원래 셀 기준이다", async () => {
    const rows = Array.from({ length: 450 }, (_, r) => {
      if (r === 99) {
        return '<tr><td rowspan="3" class="xlsx-hidden-col">병합</td><td>b</td></tr>';
      }
      if (r === 100 || r === 101) return "<tr><td>b</td></tr>";
      return `<tr><td>${r}</td><td>b</td></tr>`;
    });
    convertFileToHtml.mockResolvedValue(
      `<h2>큰 시트</h2><table>${rows.join("")}</table>`,
    );

    render(<XlsxViewer filePath="/docs/큰.xlsx" />);

    await waitFor(() => {
      expect(screen.getByTestId("xlsx-hidden-legend")).toBeTruthy();
    });
    const scroller = screen.getByTestId("xlsx-scroller");
    expect(scroller.querySelectorAll(".table-chunk").length).toBe(5);
    expect(scroller.querySelectorAll("tr").length).toBe(450);
    // 병합의 이어지는 칸이 숨김 클래스를 복사해도 시트 앵커·범례는 그대로다
    expect(scroller.querySelector("#xlsx-sheet-0")?.textContent).toBe(
      "큰 시트",
    );
    expect(scroller.querySelectorAll(".table-span-cont").length).toBe(1);
  });
});
