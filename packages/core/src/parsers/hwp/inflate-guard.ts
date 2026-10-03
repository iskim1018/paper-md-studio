/**
 * 압축 폭탄(decompression bomb) 방어 — 변환 엔진에 넘기기 전에 우리가 먼저 푼다.
 *
 * rhwp 는 HWP 스트림을 상한 없이 푼다. 270KB 짜리 파일의 본문을 256MB 의 0 으로
 * 바꾸면 rhwp 는 RSS 3GB 를 잡고 WASM 트랩으로 죽으며, WASM 메모리는 줄지 않아
 * 그 프로세스(서버·MCP)는 끝까지 3GB 를 안고 간다(실측). 그래서 Node zlib 로
 * 상한(maxOutputLength)을 걸고 먼저 풀어 크기만 잰다.
 *
 * - raw deflate 와 zlib 감싼 스트림 둘 다 잰다 — rhwp 는 둘 다 푼다(실측).
 * - `finishFlush: Z_SYNC_FLUSH` 로 끝이 잘린 스트림도 풀린 만큼 센다.
 * - 압축 데이터가 아니면(풀다 실패하면) 0 으로 친다 — 거짓 양성은 낼 수 없다.
 *   상한을 넘는 출력은 실제 deflate 스트림만 만들 수 있기 때문이다.
 */

import { constants, inflateRawSync, inflateSync } from "node:zlib";
import { HwpConversionError } from "./errors.js";

export const MIB = 1024 * 1024;

/**
 * 스트림 하나의 상한. 실물 최대 34.5MB(대형 BMP 첨부) 대비 약 3배, 기존 엔진
 * (kordoc)의 스트림당 상한과 같다 — 이전보다 더 거부하지 않는다.
 */
export const MAX_STREAM_INFLATED_BYTES = 100 * MIB;
/**
 * 본문 레코드(DocInfo·BodyText·ViewText) 합계 상한. 레코드는 엔진 안에서 객체로
 * 펼쳐져 메모리 증폭이 크다(0 으로 채운 64MB 본문 → RSS 1.2GB 실측). 실물 최대
 * 0.9MB 의 70배 — 수천 쪽 문서도 들어간다.
 */
export const MAX_RECORD_INFLATED_BYTES = 64 * MIB;
/**
 * 문서 전체 합계 상한. 실물 최대 127.7MB(20.6MB 파일, 압축비 6.2) 의 4배이고,
 * 서버 업로드 상한 50MB 문서가 같은 압축비로 풀려도(≈310MB) 들어간다.
 */
export const MAX_TOTAL_INFLATED_BYTES = 512 * MIB;

const ZLIB_HEADER_BYTE = 0x78;

type InflateFn = (
  data: Uint8Array,
  options: { maxOutputLength: number; finishFlush: number },
) => Buffer;

function isTooLarge(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

function tryInflate(
  inflate: InflateFn,
  data: Uint8Array,
  limit: number,
): number {
  try {
    return inflate(data, {
      maxOutputLength: limit,
      finishFlush: constants.Z_SYNC_FLUSH,
    }).length;
  } catch (err) {
    return isTooLarge(err) ? Number.POSITIVE_INFINITY : 0;
  }
}

/** 풀린 크기. `limit` 을 넘으면 Infinity, 압축 데이터가 아니면 0 */
export function measureInflatedSize(data: Uint8Array, limit: number): number {
  const safeLimit = Math.max(1, Math.floor(limit));
  const raw = tryInflate(inflateRawSync, data, safeLimit);
  const wrapped =
    data[0] === ZLIB_HEADER_BYTE ? tryInflate(inflateSync, data, safeLimit) : 0;
  return Math.max(raw, wrapped);
}

export interface InflateCandidate {
  readonly data: Uint8Array;
  /** 본문 레코드 스트림(DocInfo·BodyText·ViewText) 여부 */
  readonly isRecord: boolean;
}

interface Bound {
  readonly label: string;
  readonly remaining: number;
}

function bindingBound(
  isRecord: boolean,
  total: number,
  records: number,
): Bound {
  const bounds: Array<Bound> = [
    {
      label: `스트림당 ${MAX_STREAM_INFLATED_BYTES / MIB}MB`,
      remaining: MAX_STREAM_INFLATED_BYTES,
    },
    {
      label: `문서 전체 ${MAX_TOTAL_INFLATED_BYTES / MIB}MB`,
      remaining: MAX_TOTAL_INFLATED_BYTES - total,
    },
  ];
  if (isRecord) {
    bounds.push({
      label: `본문 ${MAX_RECORD_INFLATED_BYTES / MIB}MB`,
      remaining: MAX_RECORD_INFLATED_BYTES - records,
    });
  }
  return bounds.reduce((a, b) => (b.remaining < a.remaining ? b : a));
}

/** 상한(스트림·본문·전체) 중 하나라도 넘으면 TOO_LARGE 를 던진다 */
export function assertInflateWithinLimits(
  candidates: ReadonlyArray<InflateCandidate>,
): void {
  let total = 0;
  let records = 0;
  for (const { data, isRecord } of candidates) {
    const bound = bindingBound(isRecord, total, records);
    const size = measureInflatedSize(data, bound.remaining);
    if (size > bound.remaining) {
      throw new HwpConversionError(
        "TOO_LARGE",
        `압축 해제 상한 ${bound.label} 초과`,
      );
    }
    total += size;
    records += isRecord ? size : 0;
  }
}
