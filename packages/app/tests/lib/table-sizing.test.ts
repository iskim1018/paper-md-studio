import { describe, expect, it } from "vitest";
import { layoutTable } from "../../src/lib/table-chunks";
import {
  estimateColumnWidths,
  estimateRowHeights,
  sumPx,
  type TableSizingOptions,
  textWidthEm,
} from "../../src/lib/table-sizing";

const OPTIONS: TableSizingOptions = {
  fontPx: 10,
  horizontalPaddingPx: 10,
  verticalPaddingPx: 4,
  lineHeightPx: 20,
  minColumnPx: 30,
  maxColumnPx: 200,
};

const single = { colSpan: 1, rowSpan: 1 };

function linesOf(texts: ReadonlyArray<ReadonlyArray<string>>) {
  return (row: number, cell: number): ReadonlyArray<string> =>
    (texts[row]?.[cell] ?? "").split("\n");
}

describe("textWidthEm", () => {
  it("한글·한자·전각은 1em, 그 밖은 0.55em 으로 센다", () => {
    expect(textWidthEm("가나")).toBe(2);
    expect(textWidthEm("漢")).toBe(1);
    expect(textWidthEm("Ａ")).toBe(1);
    expect(textWidthEm("ab")).toBeCloseTo(1.1);
  });
});

describe("estimateColumnWidths", () => {
  it("열마다 가장 긴 줄에 맞추고 상·하한을 지킨다", () => {
    const texts = [
      ["가", "가나다라마바사아자차카타파하가나다라마바사아자차"],
      ["가나다라마", ""],
    ];
    const layout = layoutTable(texts.map((row) => row.map(() => single)));

    const widths = estimateColumnWidths(layout, linesOf(texts), OPTIONS);

    // 5자 × 10px + 여백 10 = 60, 24자는 상한 200 에 걸린다
    expect(widths).toEqual([60, 200]);
  });

  it("줄바꿈이 있으면 가장 긴 줄만 본다", () => {
    const layout = layoutTable([[single]]);
    expect(
      estimateColumnWidths(layout, linesOf([["가\n가나다"]]), OPTIONS),
    ).toEqual([40]);
  });

  it("여러 열을 합친 셀은 폭 계산에서 뺀다", () => {
    const texts = [["가나다라마바사아자차카타"], ["가", "가"]];
    const layout = layoutTable([
      [{ colSpan: 2, rowSpan: 1 }],
      [single, single],
    ]);
    expect(estimateColumnWidths(layout, linesOf(texts), OPTIONS)).toEqual([
      30, 30,
    ]);
  });
});

describe("estimateRowHeights", () => {
  it("열 폭에서 줄바꿈되는 줄 수 중 가장 큰 값으로 높이를 잡는다", () => {
    // 안쪽 폭 50px(60-10) 에 10자(100px) → 2줄
    const texts = [["가나다라마가나다라마", "가"]];
    const layout = layoutTable([[single, single]]);
    expect(
      estimateRowHeights(layout, linesOf(texts), [60, 60], OPTIONS),
    ).toEqual([44]);
  });

  it("세로 병합 셀은 높이를 나눠 가지므로 세지 않는다", () => {
    const texts = [["가\n가\n가\n가", "가"], ["가"]];
    const layout = layoutTable([
      [{ colSpan: 1, rowSpan: 2 }, single],
      [single],
    ]);
    expect(
      estimateRowHeights(layout, linesOf(texts), [60, 60], OPTIONS),
    ).toEqual([24, 24]);
  });
});

describe("sumPx", () => {
  it("px 값을 더한다", () => {
    expect(sumPx([10, 20, 30])).toBe(60);
  });
});
