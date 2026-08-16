import { createHash } from "node:crypto";

/** 파일 바이트의 SHA-256 해시를 16진수 문자열로 반환한다. */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * 변환 ID를 생성한다.
 * 현재는 파일 SHA-256이 변환 결과를 고유하게 결정하므로 해시만 사용한다.
 * 포맷은 meta.json에 별도 저장한다.
 */
export function makeConversionId(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`잘못된 SHA-256 해시 형식입니다: ${sha256}`);
  }
  return sha256;
}

/** 변환 결과에 영향을 주는 옵션 — 캐시 키에 반드시 반영해야 한다 */
export interface ConversionOptions {
  readonly includeHidden?: boolean;
}

/**
 * 옵션까지 반영한 캐시 키를 만든다.
 *
 * 같은 파일이라도 옵션이 다르면 변환 결과가 다르다 — 파일 해시만 키로 쓰면
 * "숨김 제외" 결과가 캐시에 있을 때 "숨김 포함" 요청도 그걸 돌려받는다.
 * 옵션을 해시에 섞어 새 64자리 hex 를 만들므로 conversionId 형식 검증·shard·
 * 서명 URL 은 전부 그대로 동작한다.
 */
export function conversionCacheId(
  bytes: Uint8Array,
  options: ConversionOptions = {},
): string {
  const hash = createHash("sha256");
  if (options.includeHidden === true) {
    hash.update("opt:includeHidden ");
  }
  hash.update(bytes);
  return hash.digest("hex");
}

/** 디스크 경로 분산을 위해 해시 앞 2자리를 shard로 사용한다. */
export function shardPrefix(conversionId: string): string {
  return conversionId.slice(0, 2);
}
