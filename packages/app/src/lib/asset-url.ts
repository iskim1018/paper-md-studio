/**
 * Markdown 프리뷰의 상대 이미지 경로를 Tauri asset 프로토콜 URL로 변환한다.
 *
 * 변환 결과 markdown 본문은 `./{문서명}_images/foo.png` 같은 상대 경로를 갖는데,
 * Tauri 웹뷰에서는 origin이 `tauri://localhost`(또는 dev 서버) 이므로 로컬 파일을
 * 그대로 가리킬 수 없다. `convertFileSrc`로 `asset://localhost/...` URL을 만들어
 * 주어야 webview가 안전하게 파일을 로드할 수 있다.
 *
 * tauri.conf.json의 `app.security.assetProtocol.enable: true`가 함께 필요하다.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function isAbsoluteUrl(url: string): boolean {
  return ABSOLUTE_URL_PATTERN.test(url);
}

function getDirectory(filePath: string): string {
  const last = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return last === -1 ? "" : filePath.slice(0, last);
}

function getSeparator(filePath: string): "/" | "\\" {
  return filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
}

/**
 * react-markdown(mdast→hast)이 URL을 percent-encoding한 상태로 넘기므로
 * 절대 경로 조합 전에 한 번 디코드한다. 이걸 빠뜨리면 한글 등 비ASCII 파일명이
 * `convertFileSrc`에서 다시 인코딩되어 `%25EB%25AC%25B8...`처럼 더블 인코딩되고,
 * asset 프로토콜이 파일을 찾지 못해 깨진 이미지(?)로 표시된다.
 */
function safeDecodeURI(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * 상대 경로(`./images/foo.png`, `images/foo.png` 등)를 baseFilePath 기준으로
 * 절대 경로로 해석한 뒤 Tauri asset URL을 반환한다.
 *
 * - 이미 절대 URL이거나 fragment(`#...`), data URI, 빈 문자열이면 원본 그대로 반환.
 * - baseFilePath가 비어 있으면 변환을 시도하지 않고 원본을 반환한다.
 */
export function resolveLocalAssetUrl(
  src: string,
  baseFilePath: string,
): string {
  if (!src || !baseFilePath) return src;
  if (src.startsWith("#")) return src;
  if (isAbsoluteUrl(src)) return src;

  const decoded = safeDecodeURI(src);
  const cleaned = decoded.replace(/^\.\//, "");
  const dir = getDirectory(baseFilePath);
  if (!dir) return src;

  const sep = getSeparator(baseFilePath);
  const normalizedRelative =
    sep === "\\" ? cleaned.replace(/\//g, "\\") : cleaned;
  const absolutePath = `${dir}${sep}${normalizedRelative}`;

  return convertFileSrc(absolutePath);
}
