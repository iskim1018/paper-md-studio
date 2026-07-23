import { bodyHtml, toDocument } from "./dom.js";

/**
 * 절대화 대상: 요소별 URI 속성.
 * srcset(콤마 구분 URL 목록)은 turndown이 소비하지 않으므로 의도적으로 제외.
 */
const URL_TARGETS: ReadonlyArray<{ selector: string; attr: string }> = [
  { selector: "img[src]", attr: "src" },
  { selector: "a[href]", attr: "href" },
  { selector: "source[src]", attr: "src" },
];

/** 절대화를 건너뛸 URI 패턴 (이미 절대이거나 문서 내 참조) */
const SKIP_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

/**
 * 상대 URL(src/href)을 baseUrl 기준 절대 URL로 치환한다.
 * baseUrl이 없으면 원본을 그대로 반환한다.
 */
export function resolveUrls(html: string, baseUrl?: string): string {
  if (!baseUrl) {
    return html;
  }

  const document = toDocument(html);
  for (const { selector, attr } of URL_TARGETS) {
    for (const element of document.querySelectorAll(selector)) {
      const value = element.getAttribute(attr);
      if (!value || SKIP_PATTERN.test(value.trim())) {
        continue;
      }
      try {
        element.setAttribute(attr, new URL(value, baseUrl).toString());
      } catch {
        // 해석 불가능한 URL은 원본 유지
      }
    }
  }

  return bodyHtml(document);
}
