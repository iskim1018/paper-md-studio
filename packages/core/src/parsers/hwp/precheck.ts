/**
 * 변환 엔진(rhwp)에 넘기기 전의 HWP 5.0 / HWP 3.0 사전 검사.
 *
 * 1. 우리가 먼저 거부해야 하는 문서 — 암호·DRM 은 엔진이 엉뚱한 문구(API 이름
 *    섞인 안내)로 실패하거나(암호), 아예 무시하고 암호문을 본문처럼 읽는다(DRM 비트).
 * 2. 확장자만 .hwp 인 엑셀(.xls) — 같은 OLE2 컨테이너라 매직바이트로는 못 가린다.
 * 3. 압축 폭탄 — `inflate-guard.ts` 참고.
 *
 * 컨테이너는 이미 core 의존성인 `cfb`(XLS 파서와 공유)로 연다.
 */

import CFB from "cfb";
import { decryptDistributionStream } from "./distribution.js";
import { HwpConversionError } from "./errors.js";
import {
  assertInflateWithinLimits,
  type InflateCandidate,
} from "./inflate-guard.js";

export {
  MAX_RECORD_INFLATED_BYTES,
  MAX_STREAM_INFLATED_BYTES,
  MAX_TOTAL_INFLATED_BYTES,
} from "./inflate-guard.js";

/** HWP 5.0 FileHeader 속성(u32le @36) 비트 */
const FLAG = {
  encrypted: 0x02,
  distribution: 0x04,
  drm: 0x10,
  certEncrypted: 0x100,
  certDrm: 0x400,
  trackChanges: 0x4000,
} as const;

const FILE_HEADER_SIGNATURE = "HWP Document File";
const FILE_HEADER_FLAGS_OFFSET = 36;

/** 압축하지 않는 메타데이터 스트림 — 풀어 볼 필요가 없다 (소문자) */
const UNCOMPRESSED_STREAMS: ReadonlySet<string> = new Set([
  "fileheader",
  "\u0005hwpsummaryinformation",
  "prvtext",
  "prvimage",
]);

export const TRACK_CHANGES_WARNING =
  "변경 추적이 켜진 문서입니다. 삭제 표시된 내용이 본문에 섞여 나올 수 있습니다.";

interface HwpStream {
  /** "bodytext/section0" 같은 소문자 상대 경로 */
  readonly path: string;
  readonly data: Uint8Array;
}

function toBytes(content: unknown): Uint8Array {
  return content instanceof Uint8Array
    ? content
    : Uint8Array.from(content as ArrayLike<number>);
}

/**
 * 컨테이너의 스트림을 모은다. 대소문자만 다른 같은 경로가 둘이면 손상으로
 * 본다 — 정상 문서엔 없고, 엔진이 우리가 검사하지 않은 쪽을 읽을 수 있다.
 */
function readStreams(data: Uint8Array): Array<HwpStream> {
  let container: ReturnType<typeof CFB.read>;
  try {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    container = CFB.read(buffer, { type: "buffer" });
  } catch {
    throw new HwpConversionError("CORRUPTED", "OLE2 컨테이너를 열 수 없습니다");
  }
  const streams = container.FileIndex.flatMap((entry, i) => {
    const fullPath = container.FullPaths[i];
    if (entry.type !== 2 || !entry.content || fullPath === undefined) {
      return [];
    }
    const path = fullPath.slice(fullPath.indexOf("/") + 1).toLowerCase();
    return [{ path, data: toBytes(entry.content) }];
  });
  if (new Set(streams.map(({ path }) => path)).size !== streams.length) {
    throw new HwpConversionError(
      "CORRUPTED",
      "같은 이름의 스트림이 중복됩니다",
    );
  }
  return streams;
}

function findStream(
  streams: ReadonlyArray<HwpStream>,
  path: string,
): Uint8Array | undefined {
  return streams.find((stream) => stream.path === path)?.data;
}

function readAscii(data: Uint8Array, length: number): string {
  return String.fromCharCode(...data.subarray(0, length));
}

function readHeaderFlags(streams: ReadonlyArray<HwpStream>): number {
  const header = findStream(streams, "fileheader");
  if (!header) {
    if (findStream(streams, "workbook") || findStream(streams, "book")) {
      throw new HwpConversionError("XLS_MISNAMED");
    }
    throw new HwpConversionError("CORRUPTED", "FileHeader 스트림이 없습니다");
  }
  if (
    header.length < FILE_HEADER_FLAGS_OFFSET + 4 ||
    readAscii(header, FILE_HEADER_SIGNATURE.length) !== FILE_HEADER_SIGNATURE
  ) {
    throw new HwpConversionError("CORRUPTED", "한글 문서 서명이 맞지 않습니다");
  }
  return Buffer.from(header).readUInt32LE(FILE_HEADER_FLAGS_OFFSET);
}

function assertNotProtected(flags: number): void {
  if ((flags & (FLAG.encrypted | FLAG.certEncrypted)) !== 0) {
    throw new HwpConversionError("ENCRYPTED");
  }
  if ((flags & (FLAG.drm | FLAG.certDrm)) !== 0) {
    throw new HwpConversionError("DRM_PROTECTED");
  }
}

function isRecordStream(path: string): boolean {
  return (
    path === "docinfo" ||
    path.startsWith("bodytext/") ||
    path.startsWith("viewtext/")
  );
}

/**
 * 풀어 볼 스트림 목록. 문서 압축 플래그와 무관하게 모두 본다 — 첨부(BinData)는
 * 항목별로 압축될 수 있고, 압축이 아닌 데이터는 0 으로 세어 거짓 양성이 없다.
 * 배포용 문서의 ViewText 는 엔진처럼 복호화한 뒤 잰다.
 */
function inflateCandidates(
  streams: ReadonlyArray<HwpStream>,
  flags: number,
): Array<InflateCandidate> {
  const isDistribution = (flags & FLAG.distribution) !== 0;
  return streams.flatMap(({ path, data: raw }) => {
    if (UNCOMPRESSED_STREAMS.has(path)) {
      return [];
    }
    const data =
      isDistribution && path.startsWith("viewtext/")
        ? decryptDistributionStream(raw)
        : raw;
    return data === null ? [] : [{ data, isRecord: isRecordStream(path) }];
  });
}

/** HWP 5.0(OLE2) 사전 검사. 통과하면 경고 목록을 돌려준다 */
export function precheckHwp5(data: Uint8Array): Array<string> {
  const streams = readStreams(data);
  const flags = readHeaderFlags(streams);
  assertNotProtected(flags);
  assertInflateWithinLimits(inflateCandidates(streams, flags));
  return (flags & FLAG.trackChanges) !== 0 ? [TRACK_CHANGES_WARNING] : [];
}

/** HWP 3.0 헤더 배치: 시그니처 30 + 문서 정보 128 + 요약 1008 바이트 */
const HWP3 = {
  passwordOffset: 30 + 96,
  infoBlockLengthOffset: 30 + 126,
  fixedHeaderBytes: 30 + 128 + 1008,
} as const;

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

/**
 * HWP 3.0 사전 검사. 본문은 고정 헤더·정보 블록 뒤에 raw deflate 로 통째로
 * 압축돼 있다(헤더 @154 압축 표시). 헤더가 잘린 파일은 판단하지 않고 엔진의
 * 손상 오류에 맡긴다.
 */
export function precheckHwp3(data: Uint8Array): Array<string> {
  if (
    data.length >= HWP3.passwordOffset + 2 &&
    readU16(data, HWP3.passwordOffset) !== 0
  ) {
    throw new HwpConversionError("ENCRYPTED");
  }
  if (data.length < HWP3.fixedHeaderBytes) {
    return [];
  }
  const bodyOffset =
    HWP3.fixedHeaderBytes + readU16(data, HWP3.infoBlockLengthOffset);
  if (bodyOffset < data.length) {
    assertInflateWithinLimits([
      { data: data.subarray(bodyOffset), isRecord: false },
    ]);
  }
  return [];
}
