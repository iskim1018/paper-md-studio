import { parseHTML } from "linkedom";

export type LinkedomDocument = ReturnType<typeof parseHTML>["document"];

/**
 * HTML 문자열(전체 문서 또는 fragment)을 linkedom Document로 파싱한다.
 * fragment는 body로 감싸 일관된 구조를 보장한다.
 */
export function toDocument(html: string): LinkedomDocument {
  const hasRoot = /<html[\s>]/i.test(html);
  const source = hasRoot
    ? html
    : `<html><head></head><body>${html}</body></html>`;
  return parseHTML(source).document;
}

/** Document에서 변환 대상인 body 내용을 문자열로 꺼낸다 */
export function bodyHtml(document: LinkedomDocument): string {
  const body = document.querySelector("body");
  return body ? body.innerHTML : document.toString();
}
