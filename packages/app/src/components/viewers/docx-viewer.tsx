import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  injectPageNumbers,
  preprocessDocxPageFields,
} from "../../lib/docx-page-fields";
import { readFileAsBytes } from "../../lib/file-reader";

interface DocxViewerProps {
  readonly filePath: string;
}

const DOCX_PAGE_CLASS = "docx";

async function loadDocxIntoContainer(
  filePath: string,
  container: HTMLElement,
): Promise<number> {
  const bytes = await readFileAsBytes(filePath.normalize("NFC"));
  const rawBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  // PAGE/NUMPAGES 필드를 마커 텍스트 run으로 치환한 docx 바이트
  // (docx-preview가 fldSimple/복잡 필드를 렌더하지 않는 한계 우회)
  const arrayBuffer = await preprocessDocxPageFields(rawBuffer);

  container.innerHTML = "";

  const docx = await import("docx-preview");
  await docx.renderAsync(arrayBuffer, container, undefined, {
    inWrapper: false, // 외곽 wrapper 제거 → flex 레이아웃 직접 적용
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
  });

  // 각 페이지에 인덱스 부여
  const pages = container.querySelectorAll<HTMLElement>(
    `section.${DOCX_PAGE_CLASS}`,
  );
  pages.forEach((p, i) => {
    p.dataset.pageIndex = String(i);
  });

  // 헤더/푸터의 PAGE/NUMPAGES 마커를 실제 번호로 교체
  injectPageNumbers(container, pages.length);

  return pages.length;
}

export function DocxViewer({ filePath }: DocxViewerProps) {
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setCurrentPage(0);
    setPageInput("1");
    setPageCount(0);

    const container = containerRef.current;
    if (!container) {
      setIsLoading(false);
      return;
    }

    loadDocxIntoContainer(filePath, container)
      .then((count) => {
        if (cancelled) {
          container.innerHTML = "";
          return;
        }
        setPageCount(count);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`DOCX 로드 실패: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [filePath]);

  // 첫 렌더 직후 가로 스크롤을 가운데로 맞춘다 (가로 페이지 혼재 대응).
  useLayoutEffect(() => {
    if (pageCount === 0 || !scrollRef.current) return;
    const root = scrollRef.current;
    if (root.scrollWidth > root.clientWidth) {
      root.scrollLeft = (root.scrollWidth - root.clientWidth) / 2;
    }
  }, [pageCount]);

  useEffect(() => {
    if (pageCount === 0 || !scrollRef.current || !containerRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const root = scrollRef.current;
    const pageEls = containerRef.current.querySelectorAll<HTMLElement>(
      `section.${DOCX_PAGE_CLASS}`,
    );

    const visibility = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number(
            (entry.target as HTMLElement).dataset.pageIndex ?? "0",
          );
          visibility.set(idx, entry.intersectionRatio);
        }
        let bestIdx = 0;
        let bestRatio = -1;
        for (const [idx, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIdx = idx;
          }
        }
        setCurrentPage((prev) => (prev === bestIdx ? prev : bestIdx));
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    for (const el of pageEls) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pageCount]);

  // 스크롤로 currentPage가 바뀌면 입력 필드도 동기화. 입력 중이면 덮어쓰지 않는다.
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) return;
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const scrollToPage = useCallback(
    (idx: number) => {
      if (!containerRef.current) return;
      const clamped = Math.max(0, Math.min(pageCount - 1, idx));
      // 즉각 반응을 위해 currentPage를 먼저 갱신.
      setCurrentPage(clamped);
      const pageEl = containerRef.current.querySelector<HTMLElement>(
        `section.${DOCX_PAGE_CLASS}[data-page-index="${clamped}"]`,
      );
      pageEl?.scrollIntoView({ behavior: "instant", block: "start" });
    },
    [pageCount],
  );

  const submitPageInput = useCallback(() => {
    if (pageCount === 0) return;
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
      scrollToPage(n - 1);
    } else {
      setPageInput(String(currentPage + 1));
    }
  }, [pageCount, pageInput, currentPage, scrollToPage]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d+$/.test(value)) {
      setPageInput(value);
    }
  }, []);

  const skipBlurRef = useRef(false);

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitPageInput();
        skipBlurRef.current = true;
        inputRef.current?.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPageInput(String(currentPage + 1));
        skipBlurRef.current = true;
        inputRef.current?.blur();
      }
    },
    [submitPageInput, currentPage],
  );

  const handleInputBlur = useCallback(() => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    submitPageInput();
  }, [submitPageInput]);

  const handleInputFocus = useCallback(() => {
    inputRef.current?.select();
  }, []);

  const canPrev = currentPage > 0;
  const canNext = currentPage < pageCount - 1;
  const showHeader = pageCount > 0;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid="docx-viewer"
    >
      {error && (
        <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}
      {!error && isLoading && (
        <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
          DOCX 로딩 중...
        </div>
      )}
      {!error && !isLoading && showHeader && (
        <div className="flex items-center justify-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
          <button
            type="button"
            onClick={() => scrollToPage(currentPage - 1)}
            disabled={!canPrev}
            className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="이전 페이지"
            data-testid="docx-prev"
          >
            <ChevronLeft size={14} />
          </button>
          <span
            data-testid="docx-page-indicator"
            className="flex items-center gap-1"
          >
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              onFocus={handleInputFocus}
              className="w-8 text-center bg-transparent border-b border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
              aria-label="페이지 번호 입력"
              data-testid="docx-page-input"
            />
            <span>/</span>
            <span data-testid="docx-page-count">{pageCount}</span>
          </span>
          <button
            type="button"
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={!canNext}
            className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="다음 페이지"
            data-testid="docx-next"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      {/*
        스크롤 컨테이너: docx-preview 실행 결과 DOM이 살아 있어야 하므로
        loading/error 상태에서도 마운트는 유지하고 visually hidden으로만 처리.
      */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-auto bg-[var(--color-panel-bg)] p-4 ${
          showHeader ? "" : "hidden"
        }`}
        data-testid="docx-scroller"
      >
        <div
          ref={containerRef}
          className="docx-page-container flex flex-col gap-4 min-w-max [align-items:safe_center]"
        />
      </div>
    </div>
  );
}
