/**
 * OLE2(복합 문서) 헤더·FAT 색인 파싱 — 의존성 없음.
 *
 * `cfb` 가 `CFB.read` 안에서 하는 것을 **읽기 전용**으로 다시 하되, 순환·경계
 * 검사를 넣는다. 여기서 만든 문맥(`Ole2Context`)으로 `guard.ts` 가 체인을
 * 따라가며 cfb 가 실제로 물질화할 바이트 양을 센다. [MS-CFB] 2.2 참고.
 */

import { Ole2GuardError } from "./errors.js";

/** OLE2 복합 문서 시그니처 (D0 CF 11 E0 A1 B1 1A E1) */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/** 특수 섹터 값 ([MS-CFB] 2.2) */
export const ENDOFCHAIN = -2;
export const FREESECT = -1;

const HEADER_BYTES = 512;
/** 헤더 안 DIFAT 항목 수 (offset 76 부터 i32 109개) */
const HEADER_DIFAT_COUNT = 109;
const HEADER_DIFAT_OFFSET = 76;

export interface Ole2Context {
  readonly data: Uint8Array;
  /** 섹터 크기 (v3=512, v4=4096) */
  readonly ssz: number;
  /** cfb 의 sectors 배열 길이 = ceil(fileLen/ssz) - 1 */
  readonly sectorCount: number;
  /** 첫 디렉터리 섹터 */
  readonly dirStart: number;
  /** FAT 섹터 번호 목록 (DIFAT 로 모은 것) */
  readonly fatAddrs: ReadonlyArray<number>;
}

/** 리틀엔디언 i32 (cfb __readInt32LE 와 동일, 범위 밖은 0) */
export function readI32(data: Uint8Array, off: number): number {
  if (off < 0 || off + 4 > data.length) {
    return 0;
  }
  return (
    (data[off] ?? 0) |
    ((data[off + 1] ?? 0) << 8) |
    ((data[off + 2] ?? 0) << 16) |
    ((data[off + 3] ?? 0) << 24)
  );
}

function readU16(data: Uint8Array, off: number): number {
  return (data[off] ?? 0) | ((data[off + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, off: number): number {
  return readI32(data, off) >>> 0;
}

/** OLE2 시그니처인지 (아니면 검증 대상이 아니다 — cfb 의 zip·mad 경로) */
export function hasOle2Magic(data: Uint8Array): boolean {
  if (data.length < OLE2_MAGIC.length) {
    return false;
  }
  return OLE2_MAGIC.every((byte, i) => data[i] === byte);
}

function corrupted(detail: string): Ole2GuardError {
  return new Ole2GuardError("CORRUPTED", detail);
}

/** 섹터 크기를 헤더에서 읽고 메이저 버전과 맞는지 본다 ([MS-CFB] 2.2) */
function readSectorSize(data: Uint8Array): number {
  const major = readU16(data, 26);
  const sectorShift = readU16(data, 30);
  const miniShift = readU16(data, 32);
  if (miniShift !== 6) {
    throw corrupted("미니 섹터 크기가 비정상입니다");
  }
  if (major === 3 && sectorShift === 9) {
    return 512;
  }
  if (major === 4 && sectorShift === 12) {
    return 4096;
  }
  throw corrupted("OLE2 버전·섹터 크기가 비정상입니다");
}

/** 헤더 안 109칸의 FAT 섹터 번호 (첫 음수에서 멈춤) */
function readHeaderFatAddrs(data: Uint8Array): Array<number> {
  const fatAddrs: Array<number> = [];
  for (let i = 0; i < HEADER_DIFAT_COUNT; i++) {
    const q = readI32(data, HEADER_DIFAT_OFFSET + i * 4);
    if (q < 0) {
      break;
    }
    fatAddrs.push(q);
  }
  return fatAddrs;
}

/** DIFAT 섹터 하나에 담긴 FAT 섹터 번호들을 `fatAddrs` 에 더한다 */
function collectDifatSector(
  data: Uint8Array,
  base: number,
  entriesPerSector: number,
  fatAddrs: Array<number>,
): void {
  for (let i = 0; i < entriesPerSector; i++) {
    const q = readI32(data, base + i * 4);
    if (q === ENDOFCHAIN) {
      break;
    }
    if (q >= 0) {
      fatAddrs.push(q);
    }
  }
}

/**
 * DIFAT 를 따라 FAT 섹터 번호를 모은다. 헤더의 109개 + 체인 DIFAT 섹터. 체인은
 * 방문 집합으로 순환을 끊고 섹터 수로 길이를 묶는다 — cfb 의 `sleuth_fat` 은
 * 순환·경계 검사가 없어 적대적 파일에서 폭주할 수 있다.
 */
function buildFatAddrs(
  data: Uint8Array,
  ssz: number,
  sectorCount: number,
  difatStart: number,
  difatCount: number,
): Array<number> {
  const fatAddrs = readHeaderFatAddrs(data);
  if (difatStart === ENDOFCHAIN) {
    if (difatCount !== 0) {
      throw corrupted("DIFAT 사슬이 선언보다 짧습니다");
    }
    return fatAddrs;
  }
  const entriesPerSector = Math.floor(ssz / 4) - 1;
  const seen = new Set<number>();
  let idx = difatStart;
  let remaining = difatCount;
  while (idx >= 0 && idx < sectorCount && !seen.has(idx) && remaining > 0) {
    seen.add(idx);
    const base = (idx + 1) * ssz;
    collectDifatSector(data, base, entriesPerSector, fatAddrs);
    remaining -= 1;
    idx = readI32(data, base + ssz - 4);
  }
  if (fatAddrs.length > sectorCount + 1) {
    throw corrupted("FAT 섹터 수가 파일 크기와 맞지 않습니다");
  }
  return fatAddrs;
}

/** OLE2 헤더를 읽어 검증 문맥을 만든다 (OLE2 가 아니면 호출 금지) */
export function parseOle2Context(data: Uint8Array): Ole2Context {
  if (data.length < HEADER_BYTES) {
    throw corrupted("OLE2 헤더가 잘렸습니다");
  }
  const ssz = readSectorSize(data);
  const sectorCount = Math.max(0, Math.ceil(data.length / ssz) - 1);
  const dirCount = readU32(data, 40);
  if (ssz === 512 && dirCount !== 0) {
    throw corrupted("디렉터리 섹터 수가 비정상입니다");
  }
  const dirStart = readI32(data, 48);
  const difatStart = readI32(data, 68);
  const difatCount = readU32(data, 72);
  const fatAddrs = buildFatAddrs(
    data,
    ssz,
    sectorCount,
    difatStart,
    difatCount,
  );
  return { data, ssz, sectorCount, dirStart, fatAddrs };
}

/**
 * 섹터 `j` 의 FAT 항목(다음 섹터 번호). FAT 섹터가 파일 밖이면 cfb 처럼 체인 끝
 * (undefined)으로 본다.
 */
export function readFatNext(ctx: Ole2Context, j: number): number | undefined {
  const entry = Math.floor((j * 4) / ctx.ssz);
  const addr = ctx.fatAddrs[entry];
  if (addr === undefined || addr < 0 || addr >= ctx.sectorCount) {
    return undefined;
  }
  const within = (j * 4) % ctx.ssz;
  const off = (addr + 1) * ctx.ssz + within;
  if (off + 4 > ctx.data.length) {
    return undefined;
  }
  return readI32(ctx.data, off);
}
