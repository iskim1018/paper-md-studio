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

export function sanitizeViewerHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["img"],
    ADD_ATTR: ["src", "alt"],
    ALLOWED_URI_REGEXP,
  });
}
