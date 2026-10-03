import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/html-to-md.js";
import { HwpxParser } from "../src/parsers/hwpx-parser.js";
import { buildHwpx } from "./helpers/hwpx-fixture.js";

/**
 * HTML → Markdown 변환의 복잡도 가드.
 *
 * turndown 7.2.4 는 자식마다 `join(지금까지의 출력, 자식 출력)` 을 새로
 * 만들고, 그 안의 `trimTrailingNewlines` 가 이어 붙인(rope) 문자열을 매번
 * 평탄화해 **한 부모 아래 자식 수**에 대해 O(n^2) 이었다. 문단 4만/8만/16만
 * 개가 0.28/1.6/6.4초, 40KB .hwpx(본문 XML 16MB)가 131초·RSS 2GB.
 * 최상위 문단만의 문제가 아니라 문단 하나 안의 줄바꿈(`<br>`), 목록 하나
 * 안의 항목(`<li>`)도 똑같이 제곱이라, 최상위를 쪼개 넘기는 방식으로는 막을
 * 수 없다. `patches/turndown@7.2.4.patch` 가 누적을 조각 배열로 바꿔 선형이
 * 된다 (결과는 원본과 바이트 단위로 같다).
 *
 * 이 테스트는 그 패치가 사라지는 순간을 잡는다 — `pnpm install` 사고,
 * turndown 업그레이드, patchedDependencies 유실 어느 쪽이든.
 *
 * 절대 시간이 아니라 **증가율**로 판정한다 (`packages/app/tests/
 * markdown-table-perf.test.ts` 와 같은 이유 — 두 측정에 같은 부하가 걸린다).
 * 입력을 4배로 키우면 선형은 약 4배, 제곱은 약 16배다.
 */

const GROWTH = 4;
/** 선형(≈4배)과 제곱(≈16배) 사이에 선을 긋는다 */
const MAX_GROWTH = 9;
/** 일시적 부하 튐을 걸러내려고 여러 번 재서 최솟값을 쓴다 */
const SAMPLES = 3;
/** 판정은 증가율이라 넉넉히 둔다 (패치가 빠지면 이보다 훨씬 오래 걸려 실패한다) */
const TIMEOUT_MS = 60_000;

const SMALL_PARAGRAPHS = 25_000;
const LARGE_PARAGRAPHS = SMALL_PARAGRAPHS * GROWTH;
const SMALL_CHILDREN = 20_000;

function fastestMs(run: () => unknown): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

async function fastestAsyncMs(run: () => Promise<unknown>): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = performance.now();
    await run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

function paragraphsHwpx(count: number): Uint8Array {
  const paragraph = '<p styleIDRef="0"><run><t>가</t></run></p>';
  return buildHwpx(`<sec>${paragraph.repeat(count)}</sec>`);
}

describe("HTML → Markdown 변환 시간은 입력 크기에 선형이다", () => {
  it(
    `HWPX 문단 ${LARGE_PARAGRAPHS.toLocaleString("ko-KR")}개도 ${GROWTH}배 입력에 ${MAX_GROWTH}배 미만으로 는다`,
    async () => {
      // Arrange
      const parser = new HwpxParser();
      const options = { imagesDirName: "images" };
      const small = paragraphsHwpx(SMALL_PARAGRAPHS);
      const large = paragraphsHwpx(LARGE_PARAGRAPHS);
      await parser.parseBytes(small, options); // JIT 예열

      // Act
      const smallMs = await fastestAsyncMs(() =>
        parser.parseBytes(small, options),
      );
      const largeMs = await fastestAsyncMs(() =>
        parser.parseBytes(large, options),
      );
      const result = await parser.parseBytes(large, options);

      // Assert — 문단이 하나도 빠지지 않았고, 증가율이 선형 범위다
      expect((result.markdown ?? "").split("\n\n")).toHaveLength(
        LARGE_PARAGRAPHS,
      );
      expect(largeMs / smallMs).toBeLessThan(MAX_GROWTH);
    },
    TIMEOUT_MS,
  );

  it.each([
    ["문단 하나 안의 줄바꿈", (n: number) => `<p>${"가<br>".repeat(n)}</p>`],
    [
      "목록 하나 안의 항목",
      (n: number) => `<ul>${"<li>가</li>".repeat(n)}</ul>`,
    ],
    ["최상위 문단", (n: number) => "<p>가</p>\n".repeat(n)],
  ])(
    "%s — 한 부모 아래 자식이 많아도 선형이다 (DOCX·HTML 공용 경로)",
    (_label, build) => {
      // Arrange
      const small = build(SMALL_CHILDREN);
      const large = build(SMALL_CHILDREN * GROWTH);
      htmlToMarkdown(small); // JIT 예열

      // Act
      const smallMs = fastestMs(() => htmlToMarkdown(small));
      const largeMs = fastestMs(() => htmlToMarkdown(large));

      // Assert
      expect(largeMs / smallMs).toBeLessThan(MAX_GROWTH);
    },
    TIMEOUT_MS,
  );
});
