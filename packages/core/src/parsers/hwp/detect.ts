/**
 * .hwp 확장자 파일의 실제 포맷 판별 (의존성 없는 매직바이트 검사).
 *
 * 같은 `.hwp` 라도 내용은 HWP 5.0(OLE2)·HWP 3.0·HWPML(XML) 셋으로 갈리고,
 * HWPX(ZIP)를 .hwp 로 저장한 파일도 흔하다. 변환 엔진을 부르기 전에 우리가 먼저
 * 가려야 엔진 이름이 섞인 오류 대신 한국어 안내를 줄 수 있고, PDF·이미지처럼
 * 한글 문서가 아닌 파일이 엉뚱한 경로로 새지 않는다.
 */

import { decodeXml, isHwpmlRoot, sniffXmlEncoding } from "./hwpml.js";

export type HwpFormat =
  | "empty"
  | "hwp5"
  | "hwp3"
  | "hwp-legacy"
  | "zip"
  | "hwpml"
  | "unknown";

/** UTF-16·긴 DOCTYPE 을 감안해 앞 4KB 만 본다 */
export const DETECT_PREFIX_BYTES = 4096;

/** OLE2(Compound File) 매직 — 8바이트 전부 확인한다 (4바이트만 보면 오탐) */
const OLE2_MAGIC: ReadonlyArray<number> = [
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
];
const ZIP_MAGIC: ReadonlyArray<number> = [0x50, 0x4b, 0x03, 0x04];

/** HWP 3.0 시그니처. 실제 헤더는 30바이트지만 엔진들도 이 23바이트만 본다 */
export const HWP3_SIGNATURE = "HWP Document File V3.00";
/** V3.00 이 아닌 옛 버전(V2.x·V3.1x 등)도 같은 앞머리를 쓴다 */
const HWP_LEGACY_PREFIX = "HWP Document File V";

function startsWithBytes(
  data: Uint8Array,
  magic: ReadonlyArray<number>,
): boolean {
  return (
    data.length >= magic.length && magic.every((byte, i) => data[i] === byte)
  );
}

function startsWithAscii(data: Uint8Array, text: string): boolean {
  if (data.length < text.length) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    if (data[i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function isHwpml(prefix: Uint8Array): boolean {
  const info = sniffXmlEncoding(prefix);
  return isHwpmlRoot(decodeXml(prefix, info));
}

export function detectHwpFormat(data: Uint8Array): HwpFormat {
  if (data.length === 0) {
    return "empty";
  }
  const prefix = data.subarray(0, DETECT_PREFIX_BYTES);
  if (startsWithBytes(prefix, OLE2_MAGIC)) {
    return "hwp5";
  }
  if (startsWithAscii(prefix, HWP3_SIGNATURE)) {
    return "hwp3";
  }
  if (startsWithAscii(prefix, HWP_LEGACY_PREFIX)) {
    return "hwp-legacy";
  }
  if (startsWithBytes(prefix, ZIP_MAGIC)) {
    return "zip";
  }
  if (isHwpml(prefix)) {
    return "hwpml";
  }
  return "unknown";
}

/** 옛 시그니처에서 버전 문자열(예: "V2.00")을 꺼낸다 — 오류 안내용 */
export function readLegacyVersion(data: Uint8Array): string {
  const start = HWP_LEGACY_PREFIX.length - 1;
  const raw = String.fromCharCode(...data.subarray(start, start + 5));
  return /^V\d\.\d\d$/.test(raw) ? raw : "알 수 없음";
}
