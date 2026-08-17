import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

/**
 * 큰 GFM 표의 파싱 시간 가드.
 *
 * `micromark-extension-gfm-table`의 `EditMap.add`가 편집마다 편집 목록 전체를
 * 선형 탐색해 표 크기에 대해 O(n^2)이었다. 편집은 셀 수만큼 생기므로 실물
 * 엑셀(1,104행 × 23열)에서 미리보기가 74초 멈췄다. `patches/`의 위치 색인
 * 패치로 선형이 된다 (1,600행 실측 9,560ms → 212ms).
 *
 * 이 테스트는 그 패치가 사라지는 순간을 잡는다 — `pnpm install` 사고, 의존성
 * 업그레이드, patchedDependencies 유실 어느 쪽이든. 임계값은 패치 후 실측의
 * 10배 이상 여유를 둬서 느린 CI에서도 흔들리지 않게 잡았다.
 */

const COLUMNS = 23;
const ROWS = 1600;
/** 패치 있으면 ~0.2초, 없으면 ~10초 */
const BUDGET_MS = 3000;

function buildTable(rows: number, columns: number): string {
  const cell = (r: number, c: number) => `값${r}-${c}`;
  const line = (cells: ReadonlyArray<string>) => `| ${cells.join(" | ")} |`;
  const header = line(Array.from({ length: columns }, (_, c) => `열${c}`));
  const separator = line(Array.from({ length: columns }, () => "---"));
  const body = Array.from({ length: rows }, (_, r) =>
    line(Array.from({ length: columns }, (_, c) => cell(r, c))),
  );
  return [header, separator, ...body].join("\n");
}

describe("큰 GFM 표 파싱", () => {
  it(`${ROWS}행 × ${COLUMNS}열을 ${BUDGET_MS}ms 안에 파싱한다`, () => {
    // Arrange
    const processor = unified().use(remarkParse).use(remarkGfm);
    const markdown = buildTable(ROWS, COLUMNS);

    // Act
    const started = performance.now();
    const tree = processor.parse(markdown);
    const elapsed = performance.now() - started;

    // Assert — 표가 온전히 파싱됐고(헤더 1행 + 본문), 시간 예산 안이다
    const table = tree.children.find((node) => node.type === "table");
    expect(table).toBeDefined();
    expect(table && "children" in table ? table.children.length : 0).toBe(
      ROWS + 1,
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
