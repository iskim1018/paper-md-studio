import { EyeOff, Table2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileToHtml } from "../../lib/converter";
import { sanitizeViewerHtml } from "../../lib/sanitize";
import { ViewerLoading } from "../ui/spinner";

interface XlsxViewerProps {
  readonly filePath: string;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly html: string }
  | { readonly status: "error"; readonly message: string };

/** 시트 제목(h2)에 앵커를 심어 탭에서 바로 이동할 수 있게 한다. */
const SHEET_ID_PREFIX = "xlsx-sheet-";

interface ParsedWorkbook {
  readonly html: string;
  readonly sheetNames: ReadonlyArray<string>;
  readonly hiddenCount: number;
}

/**
 * sanitize된 HTML에서 시트 제목을 뽑고 앵커 id를 심는다.
 * DOMParser로 다루므로 문자열 정규식보다 중첩·인코딩에 안전하다.
 */
function parseWorkbookHtml(html: string): ParsedWorkbook {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = [...doc.querySelectorAll("h2")];

  headings.forEach((heading, index) => {
    heading.id = `${SHEET_ID_PREFIX}${index}`;
  });

  const hiddenCount = doc.querySelectorAll(
    ".xlsx-hidden-row, .xlsx-hidden-col",
  ).length;

  return {
    html: doc.body.innerHTML,
    sheetNames: headings.map((h) => h.textContent?.trim() ?? ""),
    hiddenCount,
  };
}

/**
 * 엑셀 원본 미리보기.
 *
 * 변환 엔진이 읽어낸 시트 그대로를 표로 보여준다. 엑셀은 여느 문서와 달리
 * 원본 뷰어가 없으면 "무엇이 빠졌는지" 대조할 방법이 아예 없다 — 결과 배너가
 * 숨긴 항목을 알려줘도 원본을 못 보면 판단할 수가 없다. 그래서 여기서는
 * 숨긴 행·열까지 **포함해서** 불러오되 흐리게 표시한다.
 */
export function XlsxViewer({ filePath }: XlsxViewerProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    // 원본 뷰어이므로 숨긴 항목도 함께 불러온다 (표시는 흐리게)
    convertFileToHtml(filePath, { includeHidden: true })
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

  const workbook = useMemo<ParsedWorkbook | null>(
    () => (state.status === "done" ? parseWorkbookHtml(state.html) : null),
    [state],
  );

  const scrollToSheet = useCallback((index: number) => {
    const target = scrollRef.current?.querySelector(
      `#${SHEET_ID_PREFIX}${index}`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (state.status === "loading") {
    return <ViewerLoading label="시트를 불러오는 중..." />;
  }

  if (state.status === "error") {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[var(--color-muted)]"
        data-testid="xlsx-viewer-error"
      >
        <XCircle size={24} className="text-[var(--color-error)]" />
        <p className="text-sm">미리보기를 불러오지 못했습니다</p>
        <p className="text-xs text-[var(--color-error)] break-all">
          {state.message}
        </p>
      </div>
    );
  }

  const sheetNames = workbook?.sheetNames ?? [];
  const hasHidden = (workbook?.hiddenCount ?? 0) > 0;

  return (
    <div className="flex h-full flex-col" data-testid="xlsx-viewer">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        <Table2 size={12} />
        <span>시트 {sheetNames.length}개</span>
        {hasHidden && (
          <span
            className="ml-auto flex items-center gap-1"
            data-testid="xlsx-hidden-legend"
          >
            <EyeOff size={12} />
            흐린 칸은 숨겨진 행·열
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="xlsx-preview flex-1 overflow-auto p-4 text-sm"
        data-testid="xlsx-scroller"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeViewerHtml(DOMPurify)로 정화된 HTML만 주입
        dangerouslySetInnerHTML={{ __html: workbook?.html ?? "" }}
      />

      {/* 시트가 여러 개일 때만 탭을 둔다 — 한 장짜리엔 군더더기다 */}
      {sheetNames.length > 1 && (
        <div
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--color-border)] px-2 py-1.5"
          data-testid="xlsx-sheet-tabs"
        >
          {sheetNames.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => scrollToSheet(index)}
              className="shrink-0 cursor-pointer rounded-[6px] border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
