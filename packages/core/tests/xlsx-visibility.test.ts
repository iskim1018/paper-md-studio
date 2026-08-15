import { describe, expect, it } from "vitest";
import { projectVisibleGrid } from "../src/parsers/xlsx/visibility.js";
import type { SheetGrid } from "../src/parsers/xlsx/worksheet.js";

/**
 * 숨긴 행·열을 걷어내고 격자를 다시 투영한다.
 *
 * 숨김은 대외비 은닉일 수도, 단순히 "열이 많아 보기 불편해서"일 수도 있어
 * 사용자가 고르게 한다. 어느 쪽이든 병합 범위가 숨김과 겹치면 span을 다시
 * 계산해야 표가 어긋나지 않는다.
 */

function makeGrid(overrides: Partial<SheetGrid>): SheetGrid {
  return {
    cells: [],
    spans: new Map(),
    covered: new Set(),
    hiddenRows: new Set(),
    hiddenCols: new Set(),
    hyperlinkRels: new Map(),
    drawingRelId: null,
    ...overrides,
  };
}

describe("projectVisibleGrid", () => {
  it("숨긴 열을 제거한다", () => {
    const grid = makeGrid({
      cells: [
        ["가", "숨김", "다"],
        ["1", "2", "3"],
      ],
      hiddenCols: new Set([1]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.cells).toEqual([
      ["가", "다"],
      ["1", "3"],
    ]);
  });

  it("숨긴 행을 제거한다", () => {
    const grid = makeGrid({
      cells: [["머리"], ["숨김"], ["본문"]],
      hiddenRows: new Set([1]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.cells).toEqual([["머리"], ["본문"]]);
  });

  it("includeHidden이면 숨긴 행·열을 그대로 남긴다", () => {
    const grid = makeGrid({
      cells: [
        ["가", "숨김열"],
        ["숨김행", "값"],
      ],
      hiddenRows: new Set([1]),
      hiddenCols: new Set([1]),
    });

    const result = projectVisibleGrid(grid, true);

    expect(result.cells).toEqual([
      ["가", "숨김열"],
      ["숨김행", "값"],
    ]);
  });

  it("병합 범위가 숨긴 열과 겹치면 colSpan을 줄인다", () => {
    // A1:C1 병합 중 B열(1)이 숨김 → 보이는 열은 A·C 두 칸
    const grid = makeGrid({
      cells: [
        ["제목", "", ""],
        ["가", "나", "다"],
      ],
      spans: new Map([["0,0", { colSpan: 3, rowSpan: 1 }]]),
      covered: new Set(["0,1", "0,2"]),
      hiddenCols: new Set([1]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.spans.get("0,0")).toEqual({ colSpan: 2, rowSpan: 1 });
    expect(result.covered.has("0,1")).toBe(true);
    expect(result.cells[0]?.[0]).toBe("제목");
  });

  it("병합 범위가 숨긴 행과 겹치면 rowSpan을 줄인다", () => {
    const grid = makeGrid({
      cells: [
        ["병합", "가"],
        ["", "나"],
        ["", "다"],
      ],
      spans: new Map([["0,0", { colSpan: 1, rowSpan: 3 }]]),
      covered: new Set(["1,0", "2,0"]),
      hiddenRows: new Set([1]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.spans.get("0,0")).toEqual({ colSpan: 1, rowSpan: 2 });
  });

  it("병합의 시작 셀이 숨겨져도 내용을 첫 보이는 자리로 옮긴다", () => {
    // A1:C1 병합에서 A·B가 숨김 → 내용이 사라지면 안 되므로 C로 승격
    const grid = makeGrid({
      cells: [
        ["제목", "", ""],
        ["가", "나", "다"],
      ],
      spans: new Map([["0,0", { colSpan: 3, rowSpan: 1 }]]),
      covered: new Set(["0,1", "0,2"]),
      hiddenCols: new Set([0, 1]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.cells[0]?.[0]).toBe("제목");
    expect(result.spans.has("0,0")).toBe(false); // 1칸이라 span 불필요
  });

  it("병합 전체가 숨겨지면 통째로 제외한다", () => {
    const grid = makeGrid({
      cells: [
        ["보임", "숨김병합", ""],
        ["가", "나", "다"],
      ],
      spans: new Map([["0,1", { colSpan: 2, rowSpan: 1 }]]),
      covered: new Set(["0,2"]),
      hiddenCols: new Set([1, 2]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.cells).toEqual([["보임"], ["가"]]);
    expect(result.spans.size).toBe(0);
  });

  it("하이퍼링크 위치를 새 좌표로 다시 매긴다", () => {
    const grid = makeGrid({
      cells: [
        ["가", "숨김", "링크"],
        ["1", "2", "3"],
      ],
      hiddenCols: new Set([1]),
      hyperlinkRels: new Map([["0,2", "rId7"]]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.hyperlinkRels.get("0,1")).toBe("rId7");
    expect(result.hyperlinkRels.has("0,2")).toBe(false);
  });

  it("숨긴 열의 하이퍼링크는 버린다", () => {
    const grid = makeGrid({
      cells: [["가", "숨김링크"]],
      hiddenCols: new Set([1]),
      hyperlinkRels: new Map([["0,1", "rId7"]]),
    });

    const result = projectVisibleGrid(grid, false);

    expect(result.hyperlinkRels.size).toBe(0);
  });
});
