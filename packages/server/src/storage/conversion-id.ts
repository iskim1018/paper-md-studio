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

/** 디스크 경로 분산을 위해 해시 앞 2자리를 shard로 사용한다. */
export function shardPrefix(conversionId: string): string {
  return conversionId.slice(0, 2);
}
