import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

/**
 * 큰 GFM 표 파싱의 복잡도 가드.
 *
 * `micromark-extension-gfm-table`의 `EditMap.add`가 편집마다 편집 목록 전체를
 * 선형 탐색해 표 크기에 대해 O(n^2)이었다. 편집은 셀 수만큼 생기므로 실물
 * 엑셀(1,104행 × 23열)에서 미리보기가 74초 멈췄다. `patches/`의 위치 색인
 * 패치로 선형이 된다.
 *
 * 이 테스트는 그 패치가 사라지는 순간을 잡는다 — `pnpm install` 사고, 의존성
 * 업그레이드, patchedDependencies 유실 어느 쪽이든.
 *
 * **절대 시간이 아니라 증가율로 판정한다.** 예전엔 "1,600행을 3초 안에"였는데,
 * 패치가 있어도 기계 부하에 따라 0.6초~3.5초로 흔들려 로컬 전체 실행에서
 * 간헐 실패했다(2026-10-02). 표를 4배로 키웠을 때 시간이 몇 배가 되는지는
 * 두 측정에 같은 부하가 걸리므로 훨씬 덜 흔들린다.
 * 실측(2026-10-02, 패치 전 원본과 비교): vitest가 읽는 dev 빌드에서 패치가
 * 있으면 4~6배(전체 실행 부하 포함), 없으면 300→1200행에서 41배.
 *
 * vitest는 `development` 조건으로 `dev/lib/`을 읽는다 — 패치가 `lib/`만 고치면
 * 이 테스트는 통과해도 배포 빌드는 느릴 수 있으니 패치는 두 빌드를 함께 고친다.
 */

const COLUMNS = 23;
const SMALL_ROWS = 200;
const LARGE_ROWS = SMALL_ROWS * 4;
/** 선형이면 4~6배, 제곱이면 수십 배. 그 사이에 선을 긋는다 */
const MAX_GROWTH = 10;
/** 일시적 부하 튐을 걸러내려고 여러 번 재서 최솟값을 쓴다 */
const SAMPLES = 3;
/**
 * 측정만 8번 하므로 전체 실행 부하에서는 기본 5초를 넘는다. 판정은 시간이
 * 아니라 증가율이라 넉넉히 둔다 (패치가 빠지면 이보다 훨씬 오래 걸려 실패한다)
 */
const TIMEOUT_MS = 30_000;

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
  it(
    `표를 4배로 키워도 파싱 시간은 ${MAX_GROWTH}배 미만으로 는다 (선형)`,
    () => {
      // Arrange
      const processor = unified().use(remarkParse).use(remarkGfm);
      const small = buildTable(SMALL_ROWS, COLUMNS);
      const large = buildTable(LARGE_ROWS, COLUMNS);
      const fastest = (
        markdown: string,
      ): { ms: number; tree: ReturnType<typeof processor.parse> } => {
        let ms = Number.POSITIVE_INFINITY;
        let tree = processor.parse("");
        for (let i = 0; i < SAMPLES; i += 1) {
          const started = performance.now();
          tree = processor.parse(markdown);
          ms = Math.min(ms, performance.now() - started);
        }
        return { ms, tree };
      };
      processor.parse(small); // JIT 예열 — 첫 측정만 느린 것을 증가율로 오인하지 않게

      // Act
      const { ms: smallMs } = fastest(small);
      const { ms: largeMs, tree } = fastest(large);

      // Assert — 표가 온전히 파싱됐고(헤더 1행 + 본문), 증가율이 선형 범위다
      const table = tree.children.find((node) => node.type === "table");
      expect(table && "children" in table ? table.children.length : 0).toBe(
        LARGE_ROWS + 1,
      );
      expect(largeMs / smallMs).toBeLessThan(MAX_GROWTH);
    },
    TIMEOUT_MS,
  );
});
