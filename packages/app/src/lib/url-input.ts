/**
 * URL 입력 지원 유틸.
 * core의 is-url/url-slug와 동일 규칙 (core는 Node 전용 모듈을 포함하므로
 * 프론트엔드에서는 경량 재구현을 사용한다).
 */

const MAX_SLUG_LENGTH = 80;
const FALLBACK_SLUG = "page";

/** 입력 문자열이 http(s) URL인지 판별한다 */
export function isHttpUrl(input: string): boolean {
  if (!/^https?:\/\//i.test(input)) {
    return false;
  }
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

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

/** 목록 표시용 URL 라벨 (프로토콜 제거 + 한글 경로 디코딩) */
export function urlDisplayName(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${decodePathname(url.pathname)}`.replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
