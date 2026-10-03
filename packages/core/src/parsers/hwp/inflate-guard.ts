/**
 * 압축 폭탄(decompression bomb) 방어 — 변환 엔진에 넘기기 전에 우리가 먼저 푼다.
 *
 * rhwp 는 HWP 스트림을 상한 없이 푼다. 270KB 짜리 파일의 본문을 256MB 의 0 으로
 * 바꾸면 rhwp 는 RSS 3GB 를 잡고 WASM 트랩으로 죽으며, WASM 메모리는 줄지 않아
 * 그 프로세스(서버·MCP)는 끝까지 3GB 를 안고 간다(실측). 그래서 Node zlib 로
 * 상한(maxOutputLength)을 걸고 먼저 풀어 크기만 잰다(`inflate-measure.ts`).
 *
 * 검사 자체도 이벤트 루프를 붙잡는 동기 작업이라 작업량을 파일 크기에 묶는다:
 * - 같은 바이트를 가리키는 스트림(OLE2 디렉토리 항목 여러 개가 같은 섹터 체인을
 *   가리키면 cfb 는 같은 버퍼의 view 를 준다)은 한 번만 풀어 보되, 크기는 항목마다
 *   더한다 — 엔진은 항목마다 따로 풀기 때문이다.
 * - 풀어 본 입력 합계를 파일 크기의 배수로 제한한다(겹치는 체인 등).
 * - 스트림 수를 제한한다(항목당 고정 비용).
 */

import { HwpConversionError } from "./errors.js";
import { type ChargeWork, measureInflatedSize } from "./inflate-measure.js";

export { isZlibHeader, measureInflatedSize } from "./inflate-measure.js";

export const MIB = 1024 * 1024;

/**
 * 스트림 하나의 상한. 실물 최대 34.5MB(대형 BMP 첨부) 대비 약 3배, 기존 엔진
 * (kordoc)의 스트림당 상한과 같다 — 이전보다 더 거부하지 않는다.
 */
export const MAX_STREAM_INFLATED_BYTES = 100 * MIB;
/**
 * 본문 레코드(첨부 외 전부) 합계 상한. 레코드는 엔진 안에서 객체로 펼쳐져 메모리
 * 증폭이 크다(0 으로 채운 64MB 본문 → RSS 1.2GB 실측). 실물 최대 0.9MB 의 70배
 * — 수천 쪽 문서도 들어간다.
 */
export const MAX_RECORD_INFLATED_BYTES = 64 * MIB;
/**
 * 문서 전체 합계 상한. 실물 최대 127.7MB(20.6MB 파일, 압축비 6.2) 의 4배이고,
 * 서버 업로드 상한 50MB 문서가 같은 압축비로 풀려도(≈310MB) 들어간다.
 */
export const MAX_TOTAL_INFLATED_BYTES = 512 * MIB;
/**
 * 풀어 볼 스트림 수 상한. 실물 최대 32개(첨부 21개)의 256배 — 첨부 수천 개짜리
 * 문서도 들어간다. 스트림당 inflate 호출 고정 비용(수 µs)을 묶는다.
 */
export const MAX_INFLATE_CANDIDATES = 8192;
/**
 * 풀어 본 입력 합계 상한 = 파일 크기 × 이 값. 정상 문서는 스트림 합계가 파일
 * 크기 이하(실측 0.95~0.99배)이고, 스트림당 시도는 raw deflate 2번(16KB 확인 +
 * 실제 상한), zlib 으로 감쌌으면 3번이라 3배를 넘지 않는다 — 2.7배 여유. 넘는 건
 * 스트림들이 같은 데이터를 겹쳐 가리키거나 풀다 깨지는 스트림을 되짚을 때뿐이다.
 */
export const PRECHECK_WORK_PER_SOURCE_BYTE = 8;
/** 아주 작은 파일에서 반올림으로 거부하지 않도록 둔 하한 */
const MIN_PRECHECK_WORK_BYTES = MIB;

export interface InflateCandidate {
  readonly data: Uint8Array;
  /** 본문 레코드 상한을 받는 스트림인지 (첨부 외 전부) */
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

/** 파일 크기에 묶인 작업량 계량기 — 넘으면 손상으로 본다 */
function workMeter(sourceBytes: number): ChargeWork {
  const budget = Math.max(
    MIN_PRECHECK_WORK_BYTES,
    sourceBytes * PRECHECK_WORK_PER_SOURCE_BYTE,
  );
  let spent = 0;
  return (inputBytes) => {
    spent += inputBytes;
    if (spent > budget) {
      throw new HwpConversionError(
        "CORRUPTED",
        "스트림 데이터가 파일 크기에 비해 비정상적으로 많습니다",
      );
    }
  };
}

/** 같은 버퍼·위치·길이의 view 는 같은 바이트다 — 잰 크기를 다시 쓴다 */
class MeasureCache {
  private readonly byBuffer = new Map<ArrayBufferLike, Map<string, number>>();

  get(data: Uint8Array): number | undefined {
    return this.byBuffer.get(data.buffer)?.get(MeasureCache.key(data));
  }

  set(data: Uint8Array, size: number): void {
    const views = this.byBuffer.get(data.buffer) ?? new Map<string, number>();
    views.set(MeasureCache.key(data), size);
    this.byBuffer.set(data.buffer, views);
  }

  private static key(data: Uint8Array): string {
    return `${data.byteOffset}:${data.byteLength}`;
  }
}

function assertCandidateCount(count: number): void {
  if (count > MAX_INFLATE_CANDIDATES) {
    throw new HwpConversionError(
      "CORRUPTED",
      `스트림이 ${MAX_INFLATE_CANDIDATES}개를 넘습니다`,
    );
  }
}

/**
 * 상한(스트림·본문·전체) 중 하나라도 넘으면 TOO_LARGE, 검사 작업량·스트림 수가
 * 비정상이면 CORRUPTED 를 던진다. `sourceBytes` 는 원본 파일 크기.
 */
export function assertInflateWithinLimits(
  candidates: ReadonlyArray<InflateCandidate>,
  sourceBytes: number,
): void {
  assertCandidateCount(candidates.length);
  const charge = workMeter(sourceBytes);
  const cache = new MeasureCache();
  let total = 0;
  let records = 0;
  for (const { data, isRecord } of candidates) {
    const bound = bindingBound(isRecord, total, records);
    const size =
      cache.get(data) ?? measureInflatedSize(data, bound.remaining, charge);
    if (size > bound.remaining) {
      throw new HwpConversionError(
        "TOO_LARGE",
        `압축 해제 상한 ${bound.label} 초과`,
      );
    }
    cache.set(data, size);
    total += size;
    records += isRecord ? size : 0;
  }
}
