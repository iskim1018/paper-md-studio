const MAX_SLUG_LENGTH = 80;
const FALLBACK_SLUG = "page";

/** URL을 파일명으로 쓸 수 있는 슬러그로 변환 (예: example_com_docs_intro) */
export function urlToSlug(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const raw = `${url.hostname}${decodePathname(url.pathname)}`;
    const slug = raw
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, MAX_SLUG_LENGTH);
    return slug.length > 0 ? slug : FALLBACK_SLUG;
  } catch {
    return FALLBACK_SLUG;
  }
}

/** percent-encoding된 경로(한글 등)를 사람이 읽을 수 있게 디코딩한다 */
function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
