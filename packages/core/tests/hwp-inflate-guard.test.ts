import { constants, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assertInflateWithinLimits,
  type InflateCandidate,
  MAX_INFLATE_CANDIDATES,
  measureInflatedSize,
  PRECHECK_WORK_PER_SOURCE_BYTE,
} from "../src/parsers/hwp/inflate-guard.js";
import { deflateBomb, farBackrefZlibStream } from "./helpers/hwp-fixtures.js";

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

  it("작은 창을 선언한 zlib 헤더라도 창 밖 역참조까지 끝까지 센다 (리뷰 #1)", () => {
    // rhwp(miniz)는 헤더의 창 선언을 무시하고 32KB 창으로 끝까지 푼다. 옛 검사는
    // Node inflateSync 가 헤더 창(512B)을 강제해 중간에 멈춰 과소평가했다.
    const { stream, inflatedSize } = farBackrefZlibStream(200, 9);

    const size = measureInflatedSize(stream, 512 * MIB);

    expect(inflatedSize).toBe(200 * 1024);
    // 전체 크기를 센다 — 옛 코드는 창을 강제당해 ~32KB 만 셌다
    expect(size).toBeGreaterThanOrEqual(inflatedSize);
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

describe("assertInflateWithinLimits — 배포용 ViewText 복호화 (리뷰 #3)", () => {
  it("스트림 수 상한을 복호화보다 먼저 본다 — 상한 초과면 복호화하지 않는다", () => {
    let decryptCalls = 0;
    const decrypt = (raw: Uint8Array): Uint8Array => {
      decryptCalls += 1;
      return raw;
    };
    const many = Array.from({ length: MAX_INFLATE_CANDIDATES + 1 }, () => ({
      data: new Uint8Array([0]),
      isRecord: false,
      decrypt,
    }));

    expect(codeOf(() => assertInflateWithinLimits(many, 100 * MIB))).toBe(
      "CORRUPTED",
    );
    expect(decryptCalls).toBe(0);
  });

  it("같은 체인을 가리키는 수백 항목은 한 번만 복호화한다 (메모리 유계)", () => {
    // 2MB 암호 스트림을 800 항목이 가리킨다 — 항목마다 새 버퍼로 복호화하면
    // ≈1.6GB 를 잡았다. view 로 중복을 걸러 한 번만 복호화하는지 본다.
    const raw = new Uint8Array(2 * MIB).fill(0x11);
    let decryptCalls = 0;
    const decrypt = (data: Uint8Array): Uint8Array => {
      decryptCalls += 1;
      return Uint8Array.from(data); // 압축 아님 → 크기 0 으로 셈
    };
    const candidates = Array.from({ length: 800 }, () => ({
      data: raw,
      isRecord: true,
      decrypt,
    }));
    const start = performance.now();

    assertInflateWithinLimits(candidates, raw.length);

    expect(decryptCalls).toBe(1);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("복호화 바이트도 작업 예산에 달아 파일 크기 대비 과도하면 거부한다", () => {
    // 64KB 파일(예산 1MB) 인데 복호화가 2MB 를 내놓으면 손상으로 본다
    const raw = new Uint8Array(64 * 1024).fill(0x22);
    const decrypt = (): Uint8Array => new Uint8Array(2 * MIB).fill(0x33);

    expect(
      codeOf(() =>
        assertInflateWithinLimits(
          [{ data: raw, isRecord: true, decrypt }],
          raw.length,
        ),
      ),
    ).toBe("CORRUPTED");
  });
});
