import { bodyHtml, toDocument } from "./dom.js";

/** Markdown 변환에 불필요하거나 위험한 요소 */
const REMOVE_SELECTORS: ReadonlyArray<string> = [
  "script",
  "noscript",
  "style",
  "template",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "canvas",
  "svg",
];

const URI_ATTRIBUTES: ReadonlyArray<string> = ["href", "src"];

/**
 * HTML에서 스크립트·스타일 등 비콘텐츠 요소와 이벤트 핸들러,
 * javascript: URI를 제거한다. (linkedom은 스크립트를 실행하지 않음)
 */
export function sanitizeHtml(html: string): string {
  const document = toDocument(html);

  for (const selector of REMOVE_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      node.remove();
    }
  }

  for (const element of document.querySelectorAll("*")) {
    for (const attr of [...element.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attr.name);
      }
    }
    for (const attrName of URI_ATTRIBUTES) {
      const value = element.getAttribute(attrName);
      if (value && isDangerousUri(value)) {
        element.removeAttribute(attrName);
      }
    }
  }

  return bodyHtml(document);
}

/**
 * 스크립트 실행 가능한 URI인지 판별한다.
 * 브라우저는 URL 파싱 전에 탭·개행·제어문자를 제거하므로
 * (WHATWG URL 스펙) `java\tscript:` 같은 우회를 막으려면
 * 동일하게 정규화한 뒤 스킴을 검사해야 한다.
 */
function isDangerousUri(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자 제거가 목적
  const normalized = value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  if (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:")
  ) {
    return true;
  }
  // data: 는 이미지만 허용 (data:text/html 등 문서형 payload 차단)
  if (normalized.startsWith("data:") && !normalized.startsWith("data:image/")) {
    return true;
  }
  return false;
}
