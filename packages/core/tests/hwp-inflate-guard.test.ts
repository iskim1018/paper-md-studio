import { constants, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assertInflateWithinLimits,
  type InflateCandidate,
  MAX_INFLATE_CANDIDATES,
  measureInflatedSize,
  PRECHECK_WORK_PER_SOURCE_BYTE,
} from "../src/parsers/hwp/inflate-guard.js";
import { deflateBomb } from "./helpers/hwp-fixtures.js";

const MIB = 1024 * 1024;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return (err as { code?: string }).code;
  }
}

/** 같은 바이트를 가리키는 후보 n 개 — cfb 는 시작 섹터가 같은 항목에 같은 버퍼의 view 를 준다 */
function sharedCandidates(
  data: Uint8Array,
  count: number,
  isRecord = false,
): Array<InflateCandidate> {
  return Array.from({ length: count }, () => ({ data, isRecord }));
}

/** `megabytes` MB 를 내놓은 뒤 잘못된 블록 형식(11)으로 깨지는 raw deflate */
function breaksAfter(megabytes: number): Uint8Array {
  const body = deflateRawSync(Buffer.alloc(megabytes * MIB), {
    finishFlush: constants.Z_SYNC_FLUSH,
  });
  return new Uint8Array(Buffer.concat([body, Buffer.from([0x07, 0xff])]));
}

describe("measureInflatedSize — 풀다 깨지는 스트림", () => {
  it("일찍 깨지면(압축 데이터가 아니면) 0 이다", () => {
    expect(measureInflatedSize(new Uint8Array([0x07, 0xff, 0xff]), MIB)).toBe(
      0,
    );
  });

  it("한참 풀린 뒤 깨지면 깨지기 전까지 풀린 크기 이상으로 센다", () => {
    const size = measureInflatedSize(breaksAfter(2), 64 * MIB);

    expect(size).toBeGreaterThanOrEqual(2 * MIB);
    expect(size).toBeLessThanOrEqual(4 * MIB);
  });
});

describe("assertInflateWithinLimits — 사전 검사 자체의 작업량", () => {
  it("같은 바이트를 가리키는 스트림은 한 번만 풀어 보되 크기는 스트림마다 센다", () => {
    // 1MB 짜리 폭탄 하나를 600개 항목이 가리킨다 → 합계 600MB > 512MB
    const bomb = deflateBomb(1);
    const start = performance.now();

    const code = codeOf(() =>
      assertInflateWithinLimits(sharedCandidates(bomb, 600), bomb.length),
    );

    expect(code).toBe("TOO_LARGE");
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("같은 바이트를 가리키는 본문 스트림의 합계도 본문 상한을 받는다", () => {
    const bomb = deflateBomb(1);

    expect(
      codeOf(() =>
        assertInflateWithinLimits(sharedCandidates(bomb, 65, true), 1 * MIB),
      ),
    ).toBe("TOO_LARGE");
  });

  it("공유된 출력 0 짜리 데이터를 수천 번 가리켜도 빨리 끝난다", () => {
    // 출력 없이 입력만 소모하는 deflate (빈 비최종 블록 반복)
    const empty = deflateRawSync(Buffer.alloc(0), {
      finishFlush: constants.Z_SYNC_FLUSH,
    });
    const run = new Uint8Array(
      Buffer.concat(Array.from({ length: 200_000 }, () => empty)),
    );
    const start = performance.now();

    assertInflateWithinLimits(sharedCandidates(run, 5000), run.length * 2);

    // 항목마다 다시 풀면 수 초가 걸린다(1MB 당 ≈1ms × 5000)
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("서로 다른 사본이라도 풀어 본 입력 합계가 파일 크기의 배수를 넘으면 손상으로 거부한다", () => {
    const data = new Uint8Array(64 * 1024).fill(0x07);
    const copies = Array.from(
      { length: PRECHECK_WORK_PER_SOURCE_BYTE * 2 + 1 },
      () => ({ data: Uint8Array.from(data), isRecord: false }),
    );

    expect(codeOf(() => assertInflateWithinLimits(copies, 64 * 1024))).toBe(
      "CORRUPTED",
    );
  });

  it("스트림이 상한 개수를 넘으면 손상으로 거부한다", () => {
    const many = Array.from({ length: MAX_INFLATE_CANDIDATES + 1 }, (_, i) => ({
      data: new Uint8Array([i & 0xff]),
      isRecord: false,
    }));

    expect(codeOf(() => assertInflateWithinLimits(many, 100 * MIB))).toBe(
      "CORRUPTED",
    );
  });

  it("평범한 크기의 문서는 그대로 통과한다", () => {
    const section = deflateRawSync(Buffer.from("본문 ".repeat(10_000)));
    const attachment = deflateBomb(10);
    const candidates = [
      { data: section, isRecord: true },
      { data: attachment, isRecord: false },
    ];
    const source = section.length + attachment.length;

    expect(() => assertInflateWithinLimits(candidates, source)).not.toThrow();
  });
});
