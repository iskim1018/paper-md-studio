import { describe, expect, it } from "vitest";
import {
  type CellSpan,
  layoutTable,
  type PlannedCell,
  planTableChunks,
} from "../../src/lib/table-chunks";

const one: CellSpan = { colSpan: 1, rowSpan: 1 };

function grid(rows: number, cols: number): Array<Array<CellSpan>> {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => one),
  );
}

/** 계획을 짧은 표기로 — 열 순서까지 한눈에 비교한다 */
function describeCell(cell: PlannedCell): string {
  if (cell.kind === "own") {
    return `#${cell.cellIndex}${cell.rowSpan > 1 ? `r${cell.rowSpan}` : ""}${cell.continuesBelow ? "↓" : ""}`;
  }
  return `~${cell.sourceRow}.${cell.sourceCell}r${cell.rowSpan}${cell.colSpan > 1 ? `c${cell.colSpan}` : ""}${cell.continuesBelow ? "↓" : ""}`;
}

describe("layoutTable", () => {
  it("위에서 내려온 병합이 차지한 칸을 건너뛰고 셀을 놓는다", () => {
    // A(rowspan 2) | B
    //  (A)         | C
    const layout = layoutTable([[{ colSpan: 1, rowSpan: 2 }, one], [one]]);
    expect(layout.columnCount).toBe(2);
    expect(layout.cells[1]?.[0]?.col).toBe(1);
  });

  it("표 끝을 넘는 rowspan 은 표 안으로 자른다 — 브라우저와 같다", () => {
    const layout = layoutTable([[{ colSpan: 1, rowSpan: 9 }], [one]]);
    expect(layout.cells[0]?.[0]?.rowSpan).toBe(2);
  });

  it("0·음수·NaN span 은 1로 본다", () => {
    const layout = layoutTable([
      [
        { colSpan: 0, rowSpan: -1 },
        { colSpan: Number.NaN, rowSpan: 1 },
      ],
    ]);
    expect(layout.columnCount).toBe(2);
  });
});

describe("planTableChunks", () => {
  it("병합이 없으면 행을 그대로 나눈다", () => {
    const chunks = planTableChunks(layoutTable(grid(250, 3)), 100);
    expect(chunks.map((c) => [c.start, c.end])).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
    expect(chunks.flatMap((c) => c.rows.map((r) => r.rowIndex))).toEqual(
      Array.from({ length: 250 }, (_, i) => i),
    );
    expect(chunks[1]?.rows[0]?.cells.every((cell) => cell.kind === "own")).toBe(
      true,
    );
  });

  it("경계를 넘는 병합은 앞 묶음에서 줄이고 뒤 묶음 첫 행에 이어지는 칸을 넣는다", () => {
    // 4행 × 3열, 1행 가운데 셀이 3행을 덮는다. 2행씩 나누면 경계(2행)를 넘는다
    const rows = grid(4, 3);
    rows[1] = [one, { colSpan: 1, rowSpan: 3 }, one];
    rows[2] = [one, one];
    rows[3] = [one, one];

    const chunks = planTableChunks(layoutTable(rows), 2);

    expect(chunks[0]?.rows.map((r) => r.cells.map(describeCell))).toEqual([
      ["#0", "#1", "#2"],
      ["#0", "#1↓", "#2"],
    ]);
    // 이어지는 칸이 원래 가운데 열에 들어가야 오른쪽 셀이 당겨지지 않는다
    expect(chunks[1]?.rows.map((r) => r.cells.map(describeCell))).toEqual([
      ["#0", "~1.1r2", "#1"],
      ["#0", "#1"],
    ]);
  });

  it("여러 묶음을 가로지르는 병합은 묶음마다 이어지는 칸이 생긴다", () => {
    const rows = grid(6, 2);
    rows[0] = [{ colSpan: 1, rowSpan: 6 }, one];
    for (let r = 1; r < 6; r += 1) rows[r] = [one];

    const chunks = planTableChunks(layoutTable(rows), 2);

    expect(chunks.map((c) => c.rows[0]?.cells.map(describeCell))).toEqual([
      ["#0r2↓", "#1"],
      ["~0.0r2↓", "#0"],
      ["~0.0r2", "#0"],
    ]);
  });

  it("가로·세로로 함께 합친 셀은 이어지는 칸도 같은 폭을 차지한다", () => {
    const rows = grid(3, 3);
    rows[0] = [{ colSpan: 2, rowSpan: 3 }, one];
    rows[1] = [one];
    rows[2] = [one];

    const chunks = planTableChunks(layoutTable(rows), 1);

    expect(chunks[1]?.rows[0]?.cells.map(describeCell)).toEqual([
      "~0.0r1c2↓",
      "#0",
    ]);
  });

  it("병합에 통째로 덮여 셀이 0개인 행도 순서대로 남는다", () => {
    const rows: Array<Array<CellSpan>> = [
      [
        { colSpan: 1, rowSpan: 3 },
        { colSpan: 1, rowSpan: 3 },
      ],
      [],
      [],
      [one, one],
    ];

    const chunks = planTableChunks(layoutTable(rows), 2);

    expect(chunks.flatMap((c) => c.rows.map((r) => r.rowIndex))).toEqual([
      0, 1, 2, 3,
    ]);
    expect(chunks[1]?.rows[0]?.cells.map(describeCell)).toEqual([
      "~0.0r1",
      "~0.1r1",
    ]);
    expect(chunks[1]?.rows[1]?.cells.map(describeCell)).toEqual(["#0", "#1"]);
  });

  it("빈 표는 묶음이 없다", () => {
    expect(planTableChunks(layoutTable([]), 100)).toEqual([]);
  });
});

describe("span 해석 — 브라우저와 같게", () => {
  it('rowspan="0" 은 표 끝까지다', () => {
    const layout = layoutTable([
      [{ colSpan: 1, rowSpan: 0 }, one],
      [one],
      [one],
    ]);
    expect(layout.cells[0]?.[0]?.rowSpan).toBe(3);
    expect(layout.cells[2]?.[0]?.col).toBe(1);
  });

  it("터무니없이 큰 colspan 은 HTML 상한(1000)으로 자른다", () => {
    const layout = layoutTable([[{ colSpan: 1_000_000, rowSpan: 1 }]]);
    expect(layout.columnCount).toBe(1000);
  });

  it("묶음 첫 행의 빈 열은 채움 칸으로 메워 이어지는 칸이 당겨지지 않게 한다", () => {
    // 1행: A | B | C(3행 병합). 2·3행은 첫 칸만 있고 가운데 열은 원래 비어 있다
    const rows: Array<Array<CellSpan>> = [
      [one, one, { colSpan: 1, rowSpan: 3 }],
      [one],
      [one],
    ];
    const chunks = planTableChunks(layoutTable(rows), 1);
    expect(chunks[1]?.rows[0]?.cells.map((c) => c.kind)).toEqual([
      "own",
      "filler",
      "continuation",
    ]);
  });
});
