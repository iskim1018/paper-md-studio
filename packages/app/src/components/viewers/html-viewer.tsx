import { Globe, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { convertFileToHtml } from "../../lib/converter";
import { sanitizeViewerHtml } from "../../lib/sanitize";

interface HtmlViewerProps {
  /** 로컬 .html 파일 경로 또는 http(s) URL */
  readonly filePath: string;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly html: string }
  | { readonly status: "error"; readonly message: string };

/**
 * HTML/URL 원본 미리보기 — 실제 웹페이지가 아니라 Readability 본문
 * 추출을 거친 "변환될 본문"을 렌더링한다 (변환 품질 사전 확인 용도).
 */
export function HtmlViewer({ filePath }: HtmlViewerProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    convertFileToHtml(filePath)
      .then((html) => {
        if (cancelled) return;
        setState({ status: "done", html: sanitizeViewerHtml(html) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "미리보기 생성에 실패했습니다.";
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (state.status === "loading") {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]"
        data-testid="html-viewer-loading"
      >
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">본문을 불러오는 중...</p>
        <p className="text-xs break-all px-6 text-center">{filePath}</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[var(--color-muted)]"
        data-testid="html-viewer-error"
      >
        <XCircle size={24} className="text-[var(--color-error)]" />
        <p className="text-sm">미리보기를 불러오지 못했습니다</p>
        <p className="text-xs text-[var(--color-error)] break-all">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="html-viewer">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        <Globe size={12} />
        <span className="truncate" title={filePath}>
          {filePath}
        </span>
        <span className="ml-auto shrink-0">추출된 본문 미리보기</span>
      </div>
      <div
        className="markdown-body flex-1 overflow-y-auto p-4 text-sm leading-relaxed"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeViewerHtml(DOMPurify)로 정화된 HTML만 주입
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
    </div>
  );
}
