import { describe, expect, it, vi } from "vitest";
import { parseHwpx, unescapedPipeCounts } from "./helpers/hwpx-fixture.js";

/**
 * 표 병합 칸(colSpan·rowSpan)의 상한.
 *
 * 병합은 빈 칸(←·↑) padding 으로 펼쳐지므로 1KB 남짓한 파일의 colSpan 하나가
 * 수 MB 출력과 수 초의 CPU 로 불어났고, 아주 큰 값은 배열 펼침(spread)에서
 * 영어 RangeError 로 죽었다. 실제 상한(256열·병합 칸 20만 개)을 다 채우는
 * 표는 테스트로 만들기엔 무거워, 상한 모듈만 작게 바꿔 같은 경로를 검증한다.
 * 실물 상한 그대로의 검증은 hwpx-structure.test.ts 의 "아주 큰 colSpan" 이 맡는다.
 */
vi.mock("../src/parsers/hwpx/limits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/parsers/hwpx/limits.js")>()),
  MAX_TABLE_COLS: 8,
  MAX_MERGED_CELLS: 40,
}));

function cell(text: string, colSpan = 1, rowSpan = 1): string {
  return `<tc><subList><p><run><t>${text}</t></run></p></subList><cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/></tc>`;
}

function table(rows: ReadonlyArray<string>, attrs = ""): string {
  const trs = rows.map((r) => `<tr>${r}</tr>`).join("");
  return `<sec><p styleIDRef="0"><run><tbl${attrs}>${trs}</tbl></run></p></sec>`;
}

function columnCounts(markdown: string): Array<number> {
  return unescapedPipeCounts(markdown).map((pipes) => pipes - 1);
}

describe("HWPX 표 병합 상한 (#8)", () => {
  it("colSpan은 표의 colCnt를 넘지 못한다 — 손상된 병합이 표를 부풀리지 않는다", async () => {
    // Act
    const result = await parseHwpx(
      table(
        [cell("넓은 칸", 5000), `${cell("a")}${cell("b")}`],
        ' rowCnt="2" colCnt="2"',
      ),
    );

    // Assert
    expect(new Set(columnCounts(result.markdown ?? ""))).toEqual(new Set([2]));
    expect(result.markdown).toContain("넓은 칸");
    expect(result.warnings).toBeUndefined();
  });

  it("colCnt가 없으면 열 상한까지만 펼치고 경고한다", async () => {
    const result = await parseHwpx(table([cell("넓은 칸", 1_000_000)]));

    expect(new Set(columnCounts(result.markdown ?? ""))).toEqual(new Set([8]));
    expect(result.warnings).toEqual([
      "표 1개가 너무 커서 일부 행·열만 변환했습니다 (표 하나 최대 8열, 병합으로 생기는 칸은 문서 전체 최대 40개).",
    ]);
  });

  it("rowSpan이 남은 행 수보다 커도 행을 만들어 내지 않는다", async () => {
    const result = await parseHwpx(
      table([`${cell("세로", 1, 1_000_000)}${cell("a")}`, cell("b")]),
    );

    const rows = (result.markdown ?? "")
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(rows).toHaveLength(3); // 머리 + 구분선 + 1행
    expect(result.warnings).toBeUndefined();
  });

  it("병합 칸이 문서 전체 상한을 넘으면 넘는 행부터 잘라내고 경고한다", async () => {
    // Arrange — 행마다 실제 셀 1개 + 병합 칸 3개 (상한 40 → 13행까지)
    const rows = Array.from({ length: 30 }, (_, i) => cell(`r${i}`, 4));

    // Act
    const result = await parseHwpx(table(rows));

    // Assert
    const md = result.markdown ?? "";
    expect(md).toContain("| r12 |");
    expect(md).not.toContain("| r13 |");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toMatch(/^표 1개가 너무 커서/);
  });

  it("실제 셀은 병합 칸 상한에 세지 않는다 — 큰 표도 내용은 모두 낸다", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      [0, 1, 2, 3].map((c) => cell(`r${i}c${c}`)).join(""),
    );

    const result = await parseHwpx(table(rows));

    expect(result.markdown).toContain("r29c3");
    expect(result.warnings).toBeUndefined();
  });

  it("상한을 다 쓴 뒤의 표는 내용 대신 경고만 남기고 문서 변환은 이어진다", async () => {
    const big = Array.from({ length: 13 }, () => `<tr>${cell("x", 4)}</tr>`);
    const section = `<sec>
      <p styleIDRef="0"><run><tbl>${big.join("")}</tbl></run></p>
      <p styleIDRef="0"><run><tbl><tr>${cell("둘째 표", 4)}</tr></tbl></run></p>
      <p styleIDRef="0"><run><t>뒤 문단</t></run></p>
    </sec>`;

    const result = await parseHwpx(section);

    expect(result.markdown).toContain("뒤 문단");
    expect(result.markdown).not.toContain("둘째 표");
    expect(result.warnings?.[0]).toMatch(/^표 1개가 너무 커서/);
  });
});
