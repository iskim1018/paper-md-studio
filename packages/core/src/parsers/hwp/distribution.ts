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
 * 그래서 암호문 위치·끝 조각 처리까지 rhwp(v0.8.6 `decrypt_viewtext_payload`)를
 * 그대로 따른다. 계약 테스트(hwp-rhwp-contract)가 실제 엔진과 같은 바이트를 얻는지
 * 고정한다. 구조가 맞지 않으면 null 을 돌린다(엔진도 이때는 문서를 열지 못한다).
 */

import { createDecipheriv } from "node:crypto";

const DISTRIBUTE_DOC_DATA_TAG = 0x10 + 12;
const PAYLOAD_BYTES = 256;
const AES_BLOCK = 16;
const SEED_BYTES = 4;
/** 12비트 크기 칸이 이 값이면 뒤에 u32 크기가 따라온다(확장형 헤더) */
const EXTENDED_SIZE = 0xfff;
const SHORT_HEADER_BYTES = 4;
const EXTENDED_HEADER_BYTES = 8;

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
  const size = (word >>> 20) & EXTENDED_SIZE;
  if (size !== EXTENDED_SIZE) {
    return { tag: word & 0x3ff, size, headerBytes: SHORT_HEADER_BYTES };
  }
  if (data.length < EXTENDED_HEADER_BYTES) {
    return null;
  }
  return {
    tag: word & 0x3ff,
    size: readU32(data, SHORT_HEADER_BYTES),
    headerBytes: EXTENDED_HEADER_BYTES,
  };
}

/**
 * 암호문 시작 위치 — rhwp 규칙 그대로. 실제 헤더 길이가 아니라 **크기 값**으로
 * 헤더 길이를 정한다(`size >= 0xfff ? 8 : 4`). 확장형 헤더에 0xFFF 미만 크기를
 * 적으면 실제 헤더(8)와 어긋나 4바이트 앞에서 읽는데, 우리가 다르게 읽으면 AES 블록
 * 정렬이 틀어져 쓰레기를 재게 되고 폭탄이 검사를 비켜 간다.
 */
function ciphertextOffset(size: number): number {
  return (
    (size >= EXTENDED_SIZE ? EXTENDED_HEADER_BYTES : SHORT_HEADER_BYTES) + size
  );
}

/** AES-128-ECB 복호화. 끝의 16바이트 미만 조각은 rhwp 처럼 0 으로 채워 한 블록으로 푼다 */
function decryptAesEcb(encrypted: Uint8Array, key: Uint8Array): Uint8Array {
  const aligned = encrypted.length - (encrypted.length % AES_BLOCK);
  const tail = new Uint8Array(aligned === encrypted.length ? 0 : AES_BLOCK);
  tail.set(encrypted.subarray(aligned));
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  return new Uint8Array(
    Buffer.concat([
      decipher.update(encrypted.subarray(0, aligned)),
      decipher.update(tail),
      decipher.final(),
    ]),
  );
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

/**
 * ViewText 원본 → 복호화된 (아직 압축된) 본문. 구조가 다르면 null — 첫 레코드가
 * DISTRIBUTE_DOC_DATA 가 아니거나, 페이로드가 256바이트 미만이거나 잘렸을 때다
 * (rhwp 도 이 셋에서는 문서를 열지 못한다). 암호문이 비면 빈 배열(엔진과 같다).
 */
export function decryptDistributionStream(raw: Uint8Array): Uint8Array | null {
  const header = readRecordHeader(raw);
  if (
    header === null ||
    header.tag !== DISTRIBUTE_DOC_DATA_TAG ||
    header.size < PAYLOAD_BYTES ||
    header.headerBytes + header.size > raw.length
  ) {
    return null;
  }
  const payload = decodePayload(
    raw.subarray(header.headerBytes, header.headerBytes + PAYLOAD_BYTES),
  );
  const keyOffset = SEED_BYTES + ((payload[0] ?? 0) & 0x0f);
  const key = payload.subarray(keyOffset, keyOffset + AES_BLOCK);
  return decryptAesEcb(raw.subarray(ciphertextOffset(header.size)), key);
}
