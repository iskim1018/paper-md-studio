// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildTextIndex,
  type CellPathEntry,
  createTextIndexBuilder,
  findSegmentMatches,
} from "../../src/lib/hwpx-text-index";
import type { HwpDocument } from "../../src/lib/rhwp";

/**
 * rhwp WASM 없이 buildTextIndex/findSegmentMatches를 검증하기 위한 fake 문서.
 *
 * 경로(path) 의미는 실제 rhwp 0.7.x 동작에서 도출:
 * - entries[0..N-2]: 하강 단계 (각 entry = 표 → 셀 → 셀문단)
 * - entries[N-1]: 마지막 — controlIndex=표, cellIndex=셀, cellParaIndex=셀문단
 */
type FakeControl = FakeTable | null;
interface FakeCellPara {
  readonly text: string;
  readonly controls: ReadonlyArray<FakeControl>;
}
interface FakeCell {
  readonly paras: ReadonlyArray<FakeCellPara>;
}
interface FakeTable {
  readonly rowCount: number;
  readonly colCount: number;
  readonly cells: ReadonlyArray<FakeCell>;
}
interface FakeBodyPara {
  readonly text: string;
  readonly controls: ReadonlyArray<FakeControl>;
}

function descend(
  rootControls: ReadonlyArray<FakeControl>,
  entries: ReadonlyArray<CellPathEntry>,
): ReadonlyArray<FakeControl> {
  let controls = rootControls;
  for (const e of entries) {
    const table = controls[e.controlIndex];
    if (!table) throw new Error("not a table");
    const cell = table.cells[e.cellIndex];
    if (!cell) throw new Error("no cell");
    const cellPara = cell.paras[e.cellParaIndex];
    if (!cellPara) throw new Error("no cellpara");
    controls = cellPara.controls;
  }
  return controls;
}

function createFakeDoc(bodyParas: ReadonlyArray<FakeBodyPara>): HwpDocument {
  const lastOf = (path: ReadonlyArray<CellPathEntry>): CellPathEntry => {
    const last = path[path.length - 1];
    if (!last) throw new Error("empty path");
    return last;
  };
  const resolveTable = (
    parentPara: number,
    path: ReadonlyArray<CellPathEntry>,
  ): FakeTable => {
    const controls = descend(
      bodyParas[parentPara]?.controls ?? [],
      path.slice(0, -1),
    );
    const table = controls[lastOf(path).controlIndex];
    if (!table) throw new Error("not a table");
    return table;
  };
  const resolveCellPara = (
    parentPara: number,
    path: ReadonlyArray<CellPathEntry>,
  ): FakeCellPara => {
    const table = resolveTable(parentPara, path);
    const last = lastOf(path);
    const cell = table.cells[last.cellIndex];
    if (!cell) throw new Error("no cell");
    const cellPara = cell.paras[last.cellParaIndex];
    if (!cellPara) throw new Error("no cellpara");
    return cellPara;
  };

  const fake = {
    getSectionCount: () => 1,
    getParagraphCount: () => bodyParas.length,
    getParagraphLength: (_sec: number, para: number) =>
      bodyParas[para]?.text.length ?? 0,
    getTextRange: (_sec: number, para: number, offset: number, count: number) =>
      (bodyParas[para]?.text ?? "").slice(offset, offset + count),
    getControlTextPositions: (_sec: number, para: number) =>
      JSON.stringify((bodyParas[para]?.controls ?? []).map(() => 0)),
    getTableDimensionsByPath: (
      _sec: number,
      parentPara: number,
      pathJson: string,
    ) => {
      const table = resolveTable(parentPara, JSON.parse(pathJson));
      return JSON.stringify({
        rowCount: table.rowCount,
        colCount: table.colCount,
        cellCount: table.cells.length,
      });
    },
    getCellParagraphCountByPath: (
      _sec: number,
      parentPara: number,
      pathJson: string,
    ) => {
      const table = resolveTable(parentPara, JSON.parse(pathJson));
      const last = lastOf(JSON.parse(pathJson));
      const cell = table.cells[last.cellIndex];
      if (!cell) throw new Error("no cell");
      return cell.paras.length;
    },
    getCellParagraphLengthByPath: (
      _sec: number,
      parentPara: number,
      pathJson: string,
    ) => resolveCellPara(parentPara, JSON.parse(pathJson)).text.length,
    getTextInCellByPath: (
      _sec: number,
      parentPara: number,
      pathJson: string,
      offset: number,
      count: number,
    ) =>
      resolveCellPara(parentPara, JSON.parse(pathJson)).text.slice(
        offset,
        offset + count,
      ),
  };
  return fake as unknown as HwpDocument;
}

describe("buildTextIndex", () => {
  it("본문 + 표 셀 + 중첩 표 셀을 문서 순서대로 수집한다", () => {
    const nested: FakeTable = {
      rowCount: 1,
      colCount: 1,
      cells: [{ paras: [{ text: "중첩 설계", controls: [] }] }],
    };
    const t1: FakeTable = {
      rowCount: 1,
      colCount: 2,
      cells: [
        { paras: [{ text: "셀 설계 A", controls: [] }] },
        {
          paras: [
            { text: "", controls: [nested] },
            { text: "셀1 텍스트", controls: [] },
          ],
        },
      ],
    };
    const doc = createFakeDoc([
      { text: "본문 설계", controls: [] },
      { text: "", controls: [null, t1] },
    ]);

    const segments = buildTextIndex(doc);

    expect(segments.map((s) => s.text)).toEqual([
      "본문 설계",
      "셀 설계 A",
      "중첩 설계",
      "셀1 텍스트",
    ]);
    expect(segments[0]?.locator).toEqual({ kind: "body", sec: 0, para: 0 });
    expect(segments[1]?.locator).toEqual({
      kind: "cell",
      sec: 0,
      parentPara: 1,
      path: [{ controlIndex: 1, cellIndex: 0, cellParaIndex: 0 }],
    });
    expect(segments[2]?.locator).toEqual({
      kind: "cell",
      sec: 0,
      parentPara: 1,
      path: [
        { controlIndex: 1, cellIndex: 1, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      ],
    });
    expect(segments[3]?.locator).toEqual({
      kind: "cell",
      sec: 0,
      parentPara: 1,
      path: [{ controlIndex: 1, cellIndex: 1, cellParaIndex: 1 }],
    });
  });

  it("빈 셀 문단은 세그먼트로 만들지 않는다", () => {
    const t: FakeTable = {
      rowCount: 1,
      colCount: 1,
      cells: [{ paras: [{ text: "", controls: [] }] }],
    };
    const doc = createFakeDoc([{ text: "", controls: [t] }]);

    expect(buildTextIndex(doc)).toEqual([]);
  });
});

describe("createTextIndexBuilder", () => {
  it("예산을 잘게 쪼개 여러 번 실행해도 한 번에 만든 결과와 같다", () => {
    const nested: FakeTable = {
      rowCount: 1,
      colCount: 1,
      cells: [{ paras: [{ text: "중첩 설계", controls: [] }] }],
    };
    const t1: FakeTable = {
      rowCount: 1,
      colCount: 2,
      cells: [
        { paras: [{ text: "셀 설계 A", controls: [] }] },
        {
          paras: [
            { text: "", controls: [nested] },
            { text: "셀1 텍스트", controls: [] },
          ],
        },
      ],
    };
    const doc = createFakeDoc([
      { text: "본문 설계", controls: [] },
      { text: "", controls: [null, t1] },
    ]);

    // 예산 0ms = 작업 한 단위마다 중단 → 여러 번 나눠 실행된다
    const builder = createTextIndexBuilder(doc);
    let steps = 0;
    while (!builder.step(0)) {
      steps += 1;
      if (steps > 1000) throw new Error("빌더가 끝나지 않음");
    }

    expect(steps).toBeGreaterThan(1);
    expect(builder.snapshot()).toEqual(buildTextIndex(doc));
  });

  it("빈 문서는 첫 step에서 완료된다", () => {
    const builder = createTextIndexBuilder(createFakeDoc([]));
    expect(builder.step(0)).toBe(true);
    expect(builder.snapshot()).toEqual([]);
  });
});

describe("findSegmentMatches", () => {
  const segments = [
    { locator: { kind: "body" as const, sec: 0, para: 0 }, text: "설계 설계" },
    {
      locator: {
        kind: "cell" as const,
        sec: 0,
        parentPara: 1,
        path: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
      },
      text: "오픈API 설계",
    },
  ];

  it("세그먼트별로 모든 출현 위치를 찾는다", () => {
    const matches = findSegmentMatches(segments, "설계", false);

    expect(matches).toHaveLength(3);
    expect(matches[0]).toEqual({
      locator: segments[0]?.locator,
      charOffset: 0,
      length: 2,
    });
    expect(matches[1]).toEqual({
      locator: segments[0]?.locator,
      charOffset: 3,
      length: 2,
    });
    expect(matches[2]).toEqual({
      locator: segments[1]?.locator,
      charOffset: 6,
      length: 2,
    });
  });

  it("빈 쿼리는 매치가 없다", () => {
    expect(findSegmentMatches(segments, "", false)).toEqual([]);
  });

  it("대소문자 무시 검색이 기본 동작이다", () => {
    const segs = [
      { locator: { kind: "body" as const, sec: 0, para: 0 }, text: "Open API" },
    ];
    expect(findSegmentMatches(segs, "api", false)).toHaveLength(1);
    expect(findSegmentMatches(segs, "api", true)).toHaveLength(0);
  });
});
