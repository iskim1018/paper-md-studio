import { describe, expect, it } from "vitest";
import {
  type CellSpan,
  type SheetGrid,
  trimEmptyEdges,
} from "../src/parsers/spreadsheet/grid.js";

/**
 * 격자 가장자리 잘라내기 — 좌표에 매달린 정보(병합·링크·숨김)가 함께 옮겨지는지.
 * 변환 결과 수준의 검증은 `xlsx-tables.test.ts`의 "빈 가장자리 잘라내기"에 있다.
 */
function makeGrid(
  cells: ReadonlyArray<ReadonlyArray<string>>,
  extra: Partial<SheetGrid> = {},
): SheetGrid {
  return {
    cells,
    spans: new Map<string, CellSpan>(),
    covered: new Set<string>(),
    hiddenRows: new Set<number>(),
    hiddenCols: new Set<number>(),
    hyperlinkRels: new Map<string, string>(),
    drawingRelId: null,
    ...extra,
  };
}

describe("trimEmptyEdges", () => {
  it("여백에서 시작해 내용 쪽으로 뻗는 병합은 남은 부분만 센다", () => {
    // Arrange — A1:B3 병합(값 없음)이 여백 행·열에서 시작해 B2:B3까지 덮는다.
    // B열이 남도록 4행에 내용을 둔다 (병합만 있는 열은 내용으로 세지 않는다)
    const grid = makeGrid(
      [
        ["", "", ""],
        ["", "", "머리"],
        ["", "", "값"],
        ["", "아래", "끝"],
      ],
      {
        spans: new Map([["0,0", { rowSpan: 3, colSpan: 2 }]]),
        covered: new Set(["0,1", "1,0", "1,1", "2,0", "2,1"]),
      },
    );

    // Act
    const trimmed = trimEmptyEdges(grid);

    // Assert — 남은 병합은 B2:B3(2행×1열), 시작점은 새 좌표 0,0
    expect(trimmed.cells).toEqual([
      ["", "머리"],
      ["", "값"],
      ["아래", "끝"],
    ]);
    expect([...trimmed.spans]).toEqual([["0,0", { rowSpan: 2, colSpan: 1 }]]);
    expect([...trimmed.covered]).toEqual(["1,0"]);
  });

  it("앞뒤 양쪽에 걸친 병합은 겹치는 부분만 남기고, 한 칸이 되면 병합을 푼다", () => {
    // Arrange — A1:C4 병합(값 없음) 안쪽 B2:B3에만 내용이 있다 (비정상 병합)
    const grid = makeGrid(
      [
        ["", "", "", ""],
        ["", "가", "", ""],
        ["", "나", "", ""],
        ["", "", "", ""],
      ],
      {
        spans: new Map([["0,0", { rowSpan: 4, colSpan: 3 }]]),
        covered: new Set([
          "0,1",
          "0,2",
          "1,0",
          "1,1",
          "1,2",
          "2,0",
          "2,1",
          "2,2",
          "3,0",
          "3,1",
          "3,2",
        ]),
      },
    );

    // Act
    const trimmed = trimEmptyEdges(grid);

    // Assert — 남는 영역은 B2:B3 (2행×1열)
    expect(trimmed.cells).toEqual([["가"], ["나"]]);
    expect([...trimmed.spans]).toEqual([["0,0", { rowSpan: 2, colSpan: 1 }]]);
    expect([...trimmed.covered]).toEqual(["1,0"]);
  });

  it("여백 안에만 있는 병합은 버리고 안쪽 병합은 좌표만 옮긴다", () => {
    // Arrange — A1:A2 는 여백 병합, C3:D3 은 내용 영역의 병합
    const grid = makeGrid(
      [
        ["", "", "", ""],
        ["", "", "", ""],
        ["", "항목", "제목", ""],
        ["", "가", "1", "2"],
      ],
      {
        spans: new Map([
          ["0,0", { rowSpan: 2, colSpan: 1 }],
          ["2,2", { rowSpan: 1, colSpan: 2 }],
        ]),
        covered: new Set(["1,0", "2,3"]),
      },
    );

    // Act
    const trimmed = trimEmptyEdges(grid);

    // Assert
    expect([...trimmed.spans]).toEqual([["0,1", { rowSpan: 1, colSpan: 2 }]]);
    expect([...trimmed.covered]).toEqual(["0,2"]);
  });

  it("잘라낼 것이 없으면 같은 격자를 돌려주고 입력을 바꾸지 않는다", () => {
    // Arrange
    const grid = makeGrid([["가", "나"]], {
      spans: new Map([["0,0", { rowSpan: 1, colSpan: 2 }]]),
      covered: new Set(["0,1"]),
    });
    const trailing = makeGrid([
      ["가", ""],
      ["", ""],
    ]);
    const before = structuredClone(trailing);

    // Act & Assert
    expect(trimEmptyEdges(grid)).toBe(grid);
    expect(trimEmptyEdges(trailing).cells).toEqual([["가"]]);
    expect(trailing).toEqual(before);
  });

  it("링크·숨김 좌표를 함께 옮기고 여백에 있던 것은 버린다", () => {
    // Arrange
    const grid = makeGrid(
      [
        ["", "", ""],
        ["", "링크", "값"],
      ],
      {
        hyperlinkRels: new Map([["1,1", "rId1"]]),
        hiddenRows: new Set([0]),
        hiddenCols: new Set([0, 2]),
      },
    );

    // Act
    const trimmed = trimEmptyEdges(grid);

    // Assert
    expect(trimmed.cells).toEqual([["링크", "값"]]);
    expect([...trimmed.hyperlinkRels]).toEqual([["0,0", "rId1"]]);
    expect([...trimmed.hiddenRows]).toEqual([]);
    expect([...trimmed.hiddenCols]).toEqual([1]);
  });

  it("값 없이 링크만 걸린 셀도 내용으로 보고 남긴다", () => {
    // Arrange
    const grid = makeGrid(
      [
        ["", ""],
        ["", ""],
      ],
      { hyperlinkRels: new Map([["1,1", "rId1"]]) },
    );

    // Act
    const trimmed = trimEmptyEdges(grid);

    // Assert
    expect(trimmed.cells).toEqual([[""]]);
    expect([...trimmed.hyperlinkRels]).toEqual([["0,0", "rId1"]]);
  });

  it("내용이 없으면 빈 격자를 돌려준다", () => {
    const trimmed = trimEmptyEdges(
      makeGrid([
        ["", ""],
        ["", ""],
      ]),
    );
    expect(trimmed.cells).toEqual([]);
  });
});
