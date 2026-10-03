import DOMPurify from "dompurify";

/**
 * 원본 문서 뷰어에서 사용하는 공유 HTML sanitize 설정.
 *
 * - data: URI 허용 (HWPX 뷰어: CLI --html이 이미지를 base64 data URI로 인라인)
 * - blob: URI 허용 (DOCX 뷰어: mammoth가 이미지를 blob URL로 변환)
 * - http(s): 외부 리소스는 기본적으로 차단 (오프라인 뷰어 목적)
 * - javascript: 등 실행 가능 스킴은 제외 (XSS 방지)
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const VIEWER_CONFIG = {
  ADD_TAGS: ["img"],
  ADD_ATTR: ["src", "alt"],
  ALLOWED_URI_REGEXP,
};

export function sanitizeViewerHtml(html: string): string {
  return DOMPurify.sanitize(html, VIEWER_CONFIG);
}

/**
 * `sanitizeViewerHtml` 과 같은 규칙으로 정화하되 DOM 조각으로 돌려준다.
 *
 * 정화 결과를 다시 손볼 뷰어(엑셀 시트의 큰 표 묶음 등)는 문자열로 받으면
 * 직렬화 → 재파싱을 한 번 더 치른다. 수 MB 문서에서는 그 자체가 수십~수백 ms다.
 */
export function sanitizeViewerHtmlToFragment(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, {
    ...VIEWER_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  });
}
