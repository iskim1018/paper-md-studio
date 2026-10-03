import { EyeOff, Table2, XCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { convertFileToHtml } from "../../lib/converter";
import { chunkLargeDomTables } from "../../lib/dom-table-chunks";
import { sanitizeViewerHtmlToFragment } from "../../lib/sanitize";
import type { TableSizingOptions } from "../../lib/table-sizing";
import { ViewerLoading } from "../ui/spinner";

interface XlsxViewerProps {
  readonly filePath: string;
}

/** 시트 제목(h2)에 앵커를 심어 탭에서 바로 이동할 수 있게 한다. */
const SHEET_ID_PREFIX = "xlsx-sheet-";

/**
 * 큰 시트를 묶음으로 나눌 때의 열 폭·높이 어림 기준.
 * styles.css 의 `.xlsx-preview` 셀 규칙(14px, 줄 높이 20px, 여백 3px 8px,
 * 테두리 1px, 최대 폭 320px)과 맞춘다.
 */
const XLSX_TABLE_SIZING: TableSizingOptions = {
  fontPx: 14,
  horizontalPaddingPx: 18,
  verticalPaddingPx: 7,
  lineHeightPx: 20,
  minColumnPx: 40,
  maxColumnPx: 320,
};

interface PreparedWorkbook {
  /** 화면에 붙일 시트 묶음 (정화·앵커·큰 표 묶음 처리 완료) */
  readonly content: HTMLElement;
  readonly sheetNames: ReadonlyArray<string>;
  readonly hiddenCount: number;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly workbook: PreparedWorkbook }
  | { readonly status: "error"; readonly message: string };

/**
 * 변환 엔진의 HTML 을 화면에 붙일 수 있는 상태로 만든다.
 *
 * 정화 결과를 DOM 조각으로 받아 그 자리에서 시트 앵커를 심고, 큰 표는 행
 * 묶음으로 나눈다 — 수천 행 시트를 한 표로 그리면 레이아웃만 1.7초가 걸려
 * 파일을 고르는 순간 앱이 멈췄다(`dom-table-chunks` 참고). React 가 아닌 DOM 으로
 * 다루는 이유: 시트 하나에 셀이 수만 개라 가상 DOM 을 거칠 이유가 없다.
 */
function prepareWorkbook(html: string): PreparedWorkbook {
  const fragment = sanitizeViewerHtmlToFragment(html);
  const headings = Array.from(fragment.querySelectorAll("h2"));
  headings.forEach((heading, index) => {
    heading.id = `${SHEET_ID_PREFIX}${index}`;
  });

  // 묶음으로 나누면 병합의 이어지는 칸이 숨김 클래스를 복사하므로 그 전에 센다
  const hiddenCount = fragment.querySelectorAll(
    ".xlsx-hidden-row, .xlsx-hidden-col",
  ).length;
  chunkLargeDomTables(fragment, XLSX_TABLE_SIZING);

  const content = document.createElement("div");
  content.append(fragment);
  return {
    content,
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
        setState({ status: "done", workbook: prepareWorkbook(html) });
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

  const workbook = state.status === "done" ? state.workbook : null;

  // 준비한 DOM 을 그대로 옮겨 붙인다. 같은 요소를 다시 붙이는 것은 이동일 뿐이라
  // 개발 모드의 effect 이중 실행에도 안전하다
  useLayoutEffect(() => {
    if (workbook) scrollRef.current?.replaceChildren(workbook.content);
  }, [workbook]);

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
