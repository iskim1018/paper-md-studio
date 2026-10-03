/**
 * 스트림 하나가 풀리면 몇 바이트가 되는지 잰다 — 출력은 버리고 크기만 본다.
 *
 * - raw deflate 와 zlib 감싼 스트림 둘 다 잰다 — rhwp 는 raw 가 실패하면 zlib 으로
 *   다시 푼다(실측). zlib 은 RFC 1950 헤더가 유효하면 창 크기와 무관하게 시도한다
 *   (rhwp 의 miniz_oxide 는 창 256B~32KB 를 모두 받는다 — 첫 바이트가 0x78 만은 아니다).
 * - `finishFlush: Z_SYNC_FLUSH` 로 끝이 잘린 스트림도 풀린 만큼 센다.
 * - 풀다 깨지는 스트림: 출력 16KB 안에서 깨지면 압축 데이터가 아니라고 보고 0 으로
 *   친다(거짓 양성 방지 — 압축하지 않은 첨부 등). 그보다 뒤에서 깨지면 그만큼은
 *   엔진도 풀었다가 버리므로, 상한을 두 배씩 올려 깨지는 지점의 상한값으로 센다.
 *   0 으로 치면 "풀다 깨지는 폭탄"이 모든 상한을 비켜 가 검사만 수십 초를 쓴다.
 * - 모든 inflate 호출은 입력 길이만큼 `charge` 로 작업량을 보고한다(호출자가 파일
 *   크기에 묶는다 — `inflate-guard.ts`).
 */

import { constants, inflateRawSync, inflateSync } from "node:zlib";

/** 출력이 이보다 적은 채로 깨지면 압축 데이터가 아니라고 본다 */
export const EARLY_FAILURE_BYTES = 16 * 1024;

/** zlib(RFC 1950) 압축 방식 8 = deflate, 창 크기 지수(CINFO) 상한 7 = 32KB */
const ZLIB_METHOD_DEFLATE = 8;
const ZLIB_MAX_CINFO = 7;
const ZLIB_HEADER_CHECK = 31;

/** RFC 1950 헤더 검사 — zlib·miniz_oxide 가 받는 헤더면 true */
export function isZlibHeader(data: Uint8Array): boolean {
  const cmf = data[0];
  const flg = data[1];
  if (cmf === undefined || flg === undefined) {
    return false;
  }
  return (
    (cmf & 0x0f) === ZLIB_METHOD_DEFLATE &&
    cmf >> 4 <= ZLIB_MAX_CINFO &&
    ((cmf << 8) | flg) % ZLIB_HEADER_CHECK === 0
  );
}

/** inflate 호출 한 번의 입력 바이트를 보고받는다. 예산을 넘으면 던진다 */
export type ChargeWork = (inputBytes: number) => void;

type InflateFn = (
  data: Uint8Array,
  options: { maxOutputLength: number; finishFlush: number },
) => Buffer;

type Outcome =
  | { readonly kind: "ok"; readonly size: number }
  | { readonly kind: "exceeded" }
  | { readonly kind: "broken" };

function isTooLarge(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

function runInflate(
  inflate: InflateFn,
  data: Uint8Array,
  limit: number,
  charge: ChargeWork,
): Outcome {
  charge(data.length);
  try {
    const size = inflate(data, {
      maxOutputLength: limit,
      finishFlush: constants.Z_SYNC_FLUSH,
    }).length;
    return { kind: "ok", size };
  } catch (err) {
    return isTooLarge(err) ? { kind: "exceeded" } : { kind: "broken" };
  }
}

/**
 * `limit` 안에서 16KB 를 넘게 풀린 뒤 깨진 스트림이 깨지기 전까지 낸 출력의 상한.
 * 상한을 두 배씩 올려 처음 깨지는 값을 돌려준다(실제의 2배 이내 과대평가 — 작업량도
 * 실제 출력의 2배 이내). 같은 입력은 같은 지점에서 깨지므로 다시 풀어도 결과가 같다.
 */
function sizeBeforeBreak(
  inflate: InflateFn,
  data: Uint8Array,
  limit: number,
  charge: ChargeWork,
): number {
  for (let probe = EARLY_FAILURE_BYTES * 2; probe < limit; probe *= 2) {
    const outcome = runInflate(inflate, data, probe, charge);
    if (outcome.kind === "ok") {
      return outcome.size;
    }
    if (outcome.kind === "broken") {
      return probe;
    }
  }
  return limit;
}

/**
 * 먼저 16KB 상한으로 풀어 본다 — 압축이 아닌 데이터는 여기서 깨지고(호출 1번),
 * 작은 스트림은 여기서 끝난다. 넘칠 때만 실제 상한으로 다시 푼다.
 */
function measureWith(
  inflate: InflateFn,
  data: Uint8Array,
  limit: number,
  charge: ChargeWork,
): number {
  const early = Math.min(limit, EARLY_FAILURE_BYTES);
  const first = runInflate(inflate, data, early, charge);
  if (first.kind !== "exceeded") {
    return first.kind === "ok" ? first.size : 0;
  }
  if (early === limit) {
    return Number.POSITIVE_INFINITY;
  }
  const full = runInflate(inflate, data, limit, charge);
  switch (full.kind) {
    case "ok":
      return full.size;
    case "exceeded":
      return Number.POSITIVE_INFINITY;
    case "broken":
      return sizeBeforeBreak(inflate, data, limit, charge);
  }
}

const NO_CHARGE: ChargeWork = () => undefined;

/** 풀린 크기. `limit` 을 넘으면 Infinity, 압축 데이터가 아니면 0 */
export function measureInflatedSize(
  data: Uint8Array,
  limit: number,
  charge: ChargeWork = NO_CHARGE,
): number {
  const safeLimit = Math.max(1, Math.floor(limit));
  const raw = measureWith(inflateRawSync, data, safeLimit, charge);
  if (raw === Number.POSITIVE_INFINITY || !isZlibHeader(data)) {
    return raw;
  }
  return Math.max(raw, measureWith(inflateSync, data, safeLimit, charge));
}
