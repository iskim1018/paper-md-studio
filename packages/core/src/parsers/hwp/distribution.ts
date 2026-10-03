/**
 * HWP 5.0 배포용 문서(속성 0x04)의 ViewText 스트림 복호화.
 *
 * 배포용 문서는 본문을 BodyText 대신 ViewText/SectionN 에 암호화해 둔다:
 *   [레코드 헤더: DISTRIBUTE_DOC_DATA(태그 28), 256바이트]
 *   [256바이트 페이로드 — 앞 4바이트 시드, 나머지는 MSVC rand() 키 스트림 XOR]
 *   [AES-128-ECB 로 암호화된 (압축) 본문 — 키는 복호화된 페이로드 4+(시드&15) 위치 16바이트]
 *
 * 변환 엔진은 이걸 풀어 압축을 해제하므로, 압축 폭탄 검사도 같은 데이터를 봐야
 * 한다 — 안 그러면 배포용 플래그만 켜고 ViewText 에 폭탄을 숨기면 검사를 비껴간다.
 * 여기서는 풀기만 하고, 구조가 맞지 않으면 null 을 돌려 판단을 엔진에 넘긴다.
 */

import { createDecipheriv } from "node:crypto";

const DISTRIBUTE_DOC_DATA_TAG = 0x10 + 12;
const PAYLOAD_BYTES = 256;
const AES_BLOCK = 16;
const SEED_BYTES = 4;

interface RecordHeader {
  readonly tag: number;
  readonly size: number;
  readonly headerBytes: number;
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readRecordHeader(data: Uint8Array): RecordHeader | null {
  if (data.length < 4) {
    return null;
  }
  const word = readU32(data, 0);
  const size = (word >>> 20) & 0xfff;
  if (size !== 0xfff) {
    return { tag: word & 0x3ff, size, headerBytes: 4 };
  }
  if (data.length < 8) {
    return null;
  }
  return { tag: word & 0x3ff, size: readU32(data, 4), headerBytes: 8 };
}

/** MSVC rand() 호환 선형 합동 생성기 (0 ~ 0x7FFF) */
function msvcRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

/** 페이로드의 시드 이후 바이트를 키 스트림으로 XOR 해 원래 값을 얻는다 */
function decodePayload(payload: Uint8Array): Uint8Array {
  const rand = msvcRand(readU32(payload, 0));
  const out = Uint8Array.from(payload);
  let key = 0;
  let run = 0;
  for (let i = 0; i < PAYLOAD_BYTES; i++) {
    if (run === 0) {
      key = rand() & 0xff;
      run = (rand() & 0x0f) + 1;
    }
    if (i >= SEED_BYTES) {
      out[i] = (out[i] ?? 0) ^ key;
    }
    run--;
  }
  return out;
}

/** ViewText 원본 → 복호화된 (아직 압축된) 본문. 구조가 다르면 null */
export function decryptDistributionStream(raw: Uint8Array): Uint8Array | null {
  const header = readRecordHeader(raw);
  if (
    header === null ||
    header.tag !== DISTRIBUTE_DOC_DATA_TAG ||
    header.size < PAYLOAD_BYTES
  ) {
    return null;
  }
  const payloadEnd = header.headerBytes + header.size;
  if (payloadEnd > raw.length) {
    return null;
  }
  const payload = decodePayload(
    raw.subarray(header.headerBytes, header.headerBytes + PAYLOAD_BYTES),
  );
  const keyOffset = SEED_BYTES + ((payload[0] ?? 0) & 0x0f);
  const key = payload.subarray(keyOffset, keyOffset + AES_BLOCK);
  const encrypted = raw.subarray(payloadEnd);
  const alignedLength = encrypted.length - (encrypted.length % AES_BLOCK);
  if (alignedLength === 0) {
    return null;
  }
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  const aligned = encrypted.subarray(0, alignedLength);
  return new Uint8Array(
    Buffer.concat([decipher.update(aligned), decipher.final()]),
  );
}
