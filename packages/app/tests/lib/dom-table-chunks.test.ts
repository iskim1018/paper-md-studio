// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  chunkLargeDomTables,
  SPAN_CONTINUATION_CLASS,
  SPAN_OPEN_CLASS,
} from "../../src/lib/dom-table-chunks";
import type { TableSizingOptions } from "../../src/lib/table-sizing";

const SIZING: TableSizingOptions = {
  fontPx: 14,
  horizontalPaddingPx: 18,
  verticalPaddingPx: 7,
  lineHeightPx: 20,
  minColumnPx: 40,
  maxColumnPx: 320,
};

const SMALL = { minRows: 10, chunkRows: 10 };

function rowsHtml(count: number, cell: (r: number) => string): string {
  return Array.from({ length: count }, (_, r) => `<tr>${cell(r)}</tr>`).join(
    "",
  );
}

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** 표 셀 텍스트를 행 순서대로 — 이어지는 칸(빈 칸)은 뺀다 */
function cellTexts(root: ParentNode): Array<string> {
  return Array.from(root.querySelectorAll("td, th"))
    .filter((cell) => !cell.classList.contains(SPAN_CONTINUATION_CLASS))
    .map((cell) => cell.textContent ?? "");
}

describe("chunkLargeDomTables", () => {
  it("기준 이하의 표는 손대지 않는다", () => {
    const root = mount(`<table>${rowsHtml(5, (r) => `<td>${r}</td>`)}</table>`);
    const before = root.innerHTML;

    expect(chunkLargeDomTables(root, SIZING, SMALL)).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("큰 표를 묶음으로 나누고 행·셀·클래스를 그대로 옮긴다", () => {
    const root = mount(
      `<h2>시트</h2><table>${rowsHtml(
        25,
        (r) =>
          `<td>행${r}</td><td class="xlsx-hidden-col">숨김${r}<br>둘째 줄</td>`,
      )}</table>`,
    );
    const before = cellTexts(root);

    expect(chunkLargeDomTables(root, SIZING, SMALL)).toBe(1);

    expect(root.querySelectorAll(".table-chunked > .table-chunk").length).toBe(
      3,
    );
    expect(root.querySelectorAll("table").length).toBe(3);
    expect(root.querySelectorAll("tr").length).toBe(25);
    expect(cellTexts(root)).toEqual(before);
    expect(root.querySelectorAll("td.xlsx-hidden-col").length).toBe(25);
    expect(root.querySelectorAll("br").length).toBe(25);
    // 시트 제목은 그대로 앞에 남는다
    expect(root.firstElementChild?.tagName).toBe("H2");
  });

  it("모든 묶음이 같은 열 폭을 쓰고, 묶음 상자 폭이 표 폭과 같다", () => {
    const root = mount(
      `<table>${rowsHtml(30, (r) => `<td>${"가".repeat(r % 7)}</td><td>x</td>`)}</table>`,
    );

    chunkLargeDomTables(root, SIZING, SMALL);

    const colgroups = Array.from(root.querySelectorAll("colgroup")).map(
      (group) =>
        Array.from(group.querySelectorAll("col"))
          .map((col) => col.style.width)
          .join(","),
    );
    expect(new Set(colgroups).size).toBe(1);
    // 가장 긴 6자(84px) + 여백 18 = 102px, 짧은 열은 하한 40px
    expect(colgroups[0]).toBe("102px,40px");
    for (const box of Array.from(
      root.querySelectorAll<HTMLElement>(".table-chunk"),
    )) {
      expect(box.style.width).toBe("142px");
      expect(box.querySelector("table")?.style.width).toBe("142px");
      expect(box.style.getPropertyValue("contain-intrinsic-size")).toMatch(
        /^auto 142px auto \d+px$/,
      );
    }
  });

  it("묶음 경계를 넘는 병합은 잘라 세고 다음 묶음에 이어지는 칸을 둔다", () => {
    // 12행 × 2열, 8행 첫 칸이 4행(8~11)을 덮는다 → 10행 경계를 넘는다
    const rows = Array.from({ length: 12 }, (_, r) => {
      if (r === 8) {
        return `<td rowspan="4" class="xlsx-hidden-col">병합</td><td>b${r}</td>`;
      }
      if (r > 8) return `<td>b${r}</td>`;
      return `<td>a${r}</td><td>b${r}</td>`;
    });
    const root = mount(
      `<table>${rows.map((r) => `<tr>${r}</tr>`).join("")}</table>`,
    );

    chunkLargeDomTables(root, SIZING, SMALL);

    const [first, second] = Array.from(root.querySelectorAll("table"));
    const merged = first?.querySelector("td[rowspan]") as HTMLTableCellElement;
    expect(merged.rowSpan).toBe(2);
    expect(merged.classList.contains(SPAN_OPEN_CLASS)).toBe(true);

    const firstRow = second?.querySelector("tr") as HTMLTableRowElement;
    const continuation = firstRow.cells[0] as HTMLTableCellElement;
    expect(continuation.classList.contains(SPAN_CONTINUATION_CLASS)).toBe(true);
    // 숨김 표시도 이어받아야 병합 자리가 같은 모양으로 이어진다
    expect(continuation.classList.contains("xlsx-hidden-col")).toBe(true);
    // 이어지는 칸은 원래 셀의 "잘림" 표시까지 물려받지 않는다
    expect(continuation.classList.contains(SPAN_OPEN_CLASS)).toBe(false);
    expect(continuation.rowSpan).toBe(2);
    expect(continuation.textContent).toBe("");
    expect(firstRow.cells[1]?.textContent).toBe("b10");
  });

  it("다른 표 안에 든 표는 따로 나누지 않는다", () => {
    const inner = `<table>${rowsHtml(15, (r) => `<td>${r}</td>`)}</table>`;
    const root = mount(`<table><tr><td>${inner}</td></tr></table>`);

    expect(chunkLargeDomTables(root, SIZING, SMALL)).toBe(0);
  });
});

describe("chunkLargeDomTables — 나누지 않는 표·채움 칸", () => {
  it("머리·바닥 구역이 있는 표는 그대로 둔다", () => {
    const root = mount(
      `<table><thead><tr><th>h</th></tr></thead><tbody>${rowsHtml(15, (r) => `<td>${r}</td>`)}</tbody></table>`,
    );
    expect(chunkLargeDomTables(root, SIZING, SMALL)).toBe(0);
  });

  it("묶음 첫 행에서 원래 비어 있던 열은 채움 칸으로 메운다", () => {
    // 1행: A | B | C(11행 병합). 이후 행은 첫 칸만 — 가운데 열은 원래 빈 자리
    const rows = Array.from({ length: 12 }, (_, r) =>
      r === 0
        ? '<tr><td>A</td><td>B</td><td rowspan="11">C</td></tr>'
        : `<tr><td>a${r}</td></tr>`,
    );
    const root = mount(`<table>${rows.join("")}</table>`);

    chunkLargeDomTables(root, SIZING, SMALL);

    const second = root.querySelectorAll("table")[1];
    const first = second?.querySelector("tr") as HTMLTableRowElement;
    expect(first.cells.length).toBe(3);
    expect(first.cells[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(first.cells[2]?.classList.contains(SPAN_CONTINUATION_CLASS)).toBe(
      true,
    );
  });
});
