/**
 * HWPML(XML 기반 .hwp) 텍스트 다루기 — 인코딩 판별, 루트 판별, 버전 재작성.
 *
 * 변환 경로(core)와 앱 미리보기(app)가 같은 규칙으로 버전을 대체해야 같은 파일이
 * 한쪽에서만 열리는 일이 없다. 그래서 `node:` API 없는 순수 함수로 이 패키지에 둔다.
 */

/**
 * rhwp 가 받는 HWPML 버전(2.1·2.9·2.91) 중 대체에 쓰는 값. rhwp 의 HML 리더는
 * 버전 값으로 분기하지 않고(태그 이름으로만 해석) 버전은 메타데이터로만 흘린다.
 */
export const HWPML_FALLBACK_VERSION = "2.91";

/**
 * rhwp 가 목록에 없는 버전을 거부할 때의 문구. 1번 그룹은 원래 버전(비면 없음).
 * core 계약 테스트(hwp-rhwp-contract)가 실제 rhwp 로 이 문구를 고정한다.
 */
export const HWPML_VERSION_REJECTION = /지원하지 않는 HWPML 버전입니다: ?(.*)$/;

export type XmlEncoding = "utf-8" | "utf-16le" | "utf-16be";

export interface XmlEncodingInfo {
  readonly encoding: XmlEncoding;
  /** 바이트 순서 표식(BOM) 길이. 없으면 0 */
  readonly bomLength: number;
}

/**
 * BOM 을 먼저 보고, 없으면 앞 두 바이트의 0 위치로 UTF-16 을 가린다.
 * XML 은 ASCII 문자('<' 또는 공백)로 시작하므로 UTF-16 이면 둘 중 한 바이트가 0 이다.
 */
export function sniffXmlEncoding(bytes: Uint8Array): XmlEncodingInfo {
  const [b0, b1, b2] = [bytes[0], bytes[1], bytes[2]];
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return { encoding: "utf-8", bomLength: 3 };
  }
  if (b0 === 0xff && b1 === 0xfe) {
    return { encoding: "utf-16le", bomLength: 2 };
  }
  if (b0 === 0xfe && b1 === 0xff) {
    return { encoding: "utf-16be", bomLength: 2 };
  }
  if (b0 !== undefined && b1 !== undefined) {
    if (b0 !== 0 && b1 === 0) {
      return { encoding: "utf-16le", bomLength: 0 };
    }
    if (b0 === 0 && b1 !== 0) {
      return { encoding: "utf-16be", bomLength: 0 };
    }
  }
  return { encoding: "utf-8", bomLength: 0 };
}

/** UTF-16BE 는 런타임 ICU 구성에 기대지 않고 바이트를 뒤집어 LE 로 읽는다 */
function swapBytePairs(bytes: Uint8Array): Uint8Array {
  const evenLength = bytes.length - (bytes.length % 2);
  const swapped = new Uint8Array(evenLength);
  for (let i = 0; i < evenLength; i += 2) {
    swapped[i] = bytes[i + 1] ?? 0;
    swapped[i + 1] = bytes[i] ?? 0;
  }
  return swapped;
}

/** BOM 을 뺀 본문을 문자열로 디코드한다 (잘린 멀티바이트는 U+FFFD) */
export function decodeXml(bytes: Uint8Array, info: XmlEncodingInfo): string {
  const body = bytes.subarray(info.bomLength);
  if (info.encoding === "utf-16be") {
    return new TextDecoder("utf-16le").decode(swapBytePairs(body));
  }
  return new TextDecoder(info.encoding).decode(body);
}

/** 인코딩을 스스로 판별해 HWPML 바이트 전체를 문자열로 */
export function decodeHwpml(bytes: Uint8Array): string {
  return decodeXml(bytes, sniffXmlEncoding(bytes));
}

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = code >> 8;
  }
  return out;
}

/** 원래 인코딩·BOM 그대로 다시 바이트로 만든다 */
export function encodeXml(text: string, info: XmlEncodingInfo): Uint8Array {
  if (info.encoding === "utf-8") {
    const body = new TextEncoder().encode(text);
    if (info.bomLength === 0) {
      return body;
    }
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const le = encodeUtf16le(text);
  const body = info.encoding === "utf-16be" ? swapBytePairs(le) : le;
  if (info.bomLength === 0) {
    return body;
  }
  const bom = info.encoding === "utf-16be" ? [0xfe, 0xff] : [0xff, 0xfe];
  const out = new Uint8Array(body.length + 2);
  out.set(bom);
  out.set(body, 2);
  return out;
}

/**
 * 문서 맨 앞(선택적 XML 선언·주석·DOCTYPE 뒤)의 첫 요소가 `<HWPML` 인지.
 * DOCTYPE 내부 부분집합(`[...]`)의 `>` 에 끊기지 않게 대괄호를 따로 건너뛴다.
 */
const HWPML_ROOT =
  /^\s*(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>)\s*)*<HWPML[\s>/]/;

export function isHwpmlRoot(text: string): boolean {
  return HWPML_ROOT.test(text);
}

/** 루트 시작 태그(`<HWPML ...>`)의 위치와 원문 */
const ROOT_TAG = /<HWPML(?=[\s>/])[^>]*>/;
const VERSION_ATTR = /(\sVersion\s*=\s*)(["'])([^"']*)\2/;
const HEAD_ELEMENT = /<HEAD[\s>/]/;

/** 루트의 Version 속성값. 속성이 없으면 undefined */
export function readHwpmlVersion(text: string): string | undefined {
  const root = ROOT_TAG.exec(text);
  if (!root) {
    return undefined;
  }
  return VERSION_ATTR.exec(root[0])?.[3];
}

/**
 * 루트 Version 속성을 `version` 으로 바꾸거나(없으면 넣어) 원래 인코딩으로 돌려준다.
 * HEAD 요소가 없거나 루트를 못 찾으면 null — 버전만 고쳐서는 열리지 않는 문서다.
 */
export function rewriteHwpmlVersion(
  bytes: Uint8Array,
  version: string,
): Uint8Array | null {
  const info = sniffXmlEncoding(bytes);
  const text = decodeXml(bytes, info);
  const root = ROOT_TAG.exec(text);
  if (!root || !HEAD_ELEMENT.test(text)) {
    return null;
  }
  const tag = root[0];
  const newTag = VERSION_ATTR.test(tag)
    ? tag.replace(VERSION_ATTR, `$1$2${version}$2`)
    : tag.replace("<HWPML", `<HWPML Version="${version}"`);
  const rewritten =
    text.slice(0, root.index) + newTag + text.slice(root.index + tag.length);
  return encodeXml(rewritten, info);
}
