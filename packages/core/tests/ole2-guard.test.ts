import { describe, expect, it } from "vitest";
import { assertSafeOle2, Ole2GuardError } from "../src/parsers/ole2/guard.js";
import {
  buildOle2,
  ENDOFCHAIN,
  FATSECT,
  type Ole2Spec,
  rootEntry,
} from "./helpers/ole2-builder.js";

function reasonOf(data: Uint8Array): string | undefined {
  try {
    assertSafeOle2(data);
    return undefined;
  } catch (err) {
    expect(err).toBeInstanceOf(Ole2GuardError);
    return (err as Ole2GuardError).reason;
  }
}

/** 정상에 가까운 최소 OLE2: FAT 섹터 0, 디렉터리 섹터 1 */
function minimalSpec(overrides: Partial<Ole2Spec> = {}): Ole2Spec {
  return {
    sectorCount: 2,
    fatSectors: [0],
    fat: [FATSECT, ENDOFCHAIN],
    dirStart: 1,
    entries: [rootEntry()],
    ...overrides,
  };
}

describe("assertSafeOle2 — 적대적 OLE2 거부", () => {
  it("OLE2 가 아니면(zip 등) 아무것도 하지 않는다", () => {
    expect(() =>
      assertSafeOle2(new Uint8Array([0x50, 0x4b, 3, 4])),
    ).not.toThrow();
    expect(() => assertSafeOle2(new Uint8Array(0))).not.toThrow();
  });

  it("정상 구조는 통과한다", () => {
    expect(() => assertSafeOle2(buildOle2(minimalSpec()))).not.toThrow();
  });

  it("FAT 사슬 순환(중간 체인을 가리키는 항목)은 빠르게 손상으로 거부한다", () => {
    // 섹터 2→3→4→3 순환. 항목이 3(체인 머리가 아님)을 가리켜 cfb 는
    // get_sector_list 로 무한 루프에 빠진다.
    const fat = [FATSECT, ENDOFCHAIN, 3, 4, 3];
    const data = buildOle2({
      sectorCount: 5,
      fatSectors: [0],
      fat,
      dirStart: 1,
      entries: [rootEntry(1), { name: "S", type: 2, start: 3, size: 8192 }],
    });
    const start = performance.now();
    expect(reasonOf(data)).toBe("CORRUPTED");
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("DIFAT 사슬 순환은 폭주 없이 손상으로 거부한다", () => {
    // 전용 DIFAT 섹터(2)가 자기 자신을 다음 DIFAT 섹터로 가리킨다
    const data = buildOle2({
      sectorCount: 3,
      fatSectors: [0],
      fat: [FATSECT, ENDOFCHAIN, ENDOFCHAIN],
      dirStart: 1,
      entries: [rootEntry()],
      difatStart: 2,
      difatCount: 1_000_000,
    });
    const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    view.writeInt32LE(2, (2 + 1) * 512 - 4); // 섹터 2 마지막 4바이트 = 2 (자기참조)
    const start = performance.now();
    // 방문 집합으로 순환을 끊어 폭주하지 않고, 망가진 구조라 손상으로 거부한다
    expect(reasonOf(new Uint8Array(view))).toBe("CORRUPTED");
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("디렉터리 트리(L/R/C) 형제 순환은 손상으로 거부한다", () => {
    // 1.L=2, 2.L=1 → cfb build_full_paths 가 OOM
    const data = buildOle2({
      sectorCount: 2,
      fatSectors: [0],
      fat: [FATSECT, ENDOFCHAIN],
      dirStart: 1,
      entries: [
        rootEntry(1),
        { name: "A", type: 2, left: 2, start: ENDOFCHAIN, size: 0 },
        { name: "B", type: 2, left: 1, start: ENDOFCHAIN, size: 0 },
      ],
    });
    expect(reasonOf(data)).toBe("CORRUPTED");
  });

  it("같은 큰 체인을 가리키는 항목이 많으면 과대로 거부한다 (메모리 유계)", () => {
    // 레이아웃: FAT 12섹터 + 디렉터리 사슬 375섹터(1500항목) + 데이터 사슬 ~1000섹터.
    // 1500개 항목이 모두 데이터 사슬 중간을 가리킨다 → cfb 는 항목마다 나머지
    // 체인을 통째로 복사해 수백 MB~GB. 파일은 ≈0.7MB.
    const fatCount = 12;
    const dirSectors = 375;
    const dataSectors = 1000;
    const sectorCount = fatCount + dirSectors + dataSectors;
    const dirStart = fatCount;
    const dataStart = fatCount + dirSectors;
    const fat: Array<number> = new Array(sectorCount).fill(ENDOFCHAIN);
    for (let s = 0; s < fatCount; s++) {
      fat[s] = FATSECT;
    }
    for (let s = dirStart; s < dataStart - 1; s++) {
      fat[s] = s + 1;
    }
    fat[dataStart - 1] = ENDOFCHAIN;
    for (let s = dataStart; s < sectorCount - 1; s++) {
      fat[s] = s + 1;
    }
    fat[sectorCount - 1] = ENDOFCHAIN;
    const fatSectors = Array.from({ length: fatCount }, (_, i) => i);
    const entries = [rootEntry(1)];
    for (let i = 0; i < 1500; i++) {
      // 데이터 사슬의 중간(머리가 아님)을 가리킨다
      entries.push({
        name: `S${i}`,
        type: 2,
        start: dataStart + 1,
        size: (dataSectors - 1) * 512,
      });
    }
    const data = buildOle2({ sectorCount, fatSectors, fat, dirStart, entries });
    const start = performance.now();
    expect(reasonOf(data)).toBe("TOO_LARGE");
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("뒤로 겹치는 FAT(역방향 체인)의 O(n²) 물질화를 과대로 거부한다", () => {
    // 섹터 i → i-1. make_sector_list 가 꼬리마다 머리까지 재순회 → 2차식.
    const sectorCount = 600;
    const fat: Array<number> = [FATSECT, ENDOFCHAIN];
    for (let s = 2; s < sectorCount; s++) {
      fat[s] = s - 1;
    }
    const data = buildOle2({
      sectorCount,
      fatSectors: [0, 1],
      fat,
      dirStart: 1,
      entries: [rootEntry()],
    });
    const start = performance.now();
    expect(reasonOf(data)).toBe("TOO_LARGE");
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("파일 밖에서 시작하는 항목은 크래시 없이 넘어간다", () => {
    const data = buildOle2(
      minimalSpec({
        entries: [
          rootEntry(1),
          { name: "X", type: 2, start: 99999, size: 8192 },
        ],
      }),
    );
    expect(() => assertSafeOle2(data)).not.toThrow();
  });

  it("헤더가 잘렸으면(512바이트 미만) 손상으로 거부한다", () => {
    const tiny = new Uint8Array(64);
    tiny.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(reasonOf(tiny)).toBe("CORRUPTED");
  });
});
