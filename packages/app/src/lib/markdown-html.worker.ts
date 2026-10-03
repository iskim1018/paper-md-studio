import { renderMarkdownToHtml } from "./markdown-html";

/**
 * 결과 미리보기의 Markdown → HTML 변환을 메인 스레드 밖에서 돌린다.
 * 요청·응답 형식은 `use-markdown-html.ts` 와 짝이다.
 */

export interface MarkdownHtmlRequest {
  readonly id: number;
  readonly markdown: string;
}

export type MarkdownHtmlResponse =
  | { readonly id: number; readonly html: string }
  | { readonly id: number; readonly error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<MarkdownHtmlRequest>) => void) | null;
  postMessage: (message: MarkdownHtmlResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, markdown } = event.data;
  try {
    scope.postMessage({ id, html: renderMarkdownToHtml(markdown) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    scope.postMessage({ id, error: message });
  }
};
