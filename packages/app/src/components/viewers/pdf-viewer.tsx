import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { readFileAsBytes } from "../../lib/file-reader";

interface PdfViewerProps {
  readonly filePath: string;
}

interface PageInfo {
  readonly width: number; // viewport width at scale=1 (CSS px)
  readonly height: number;
}

interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (ctx: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => RenderTask;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

interface RenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

const SCALE_STEP = 0.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4.0;
const SCROLL_PADDING_PX = 32; // p-4 양옆

async function loadPdf(filePath: string): Promise<{
  doc: PdfDocument;
  pages: Array<PageInfo>;
}> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const bytes = await readFileAsBytes(filePath);
  const doc = (await pdfjsLib.getDocument({ data: bytes })
    .promise) as unknown as PdfDocument;

  const pages: Array<PageInfo> = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ width: viewport.width, height: viewport.height });
  }
  return { doc, pages };
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [pageInfos, setPageInfos] = useState<Array<PageInfo>>([]);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<PdfDocument | null>(null);
  const canvasRefsMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderedScalesMap = useRef<Map<number, number>>(new Map());
  const renderTasksMap = useRef<Map<number, RenderTask>>(new Map());
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const scaleRef = useRef(scale);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // PDF 로드 + 모든 페이지 viewport 사이즈 사전 수집
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPageInfos([]);
    setCurrentPage(0);
    setPageInput("1");
    setScale(1);

    // 이전 PDF의 in-flight render 취소 + 맵 초기화
    for (const task of renderTasksMap.current.values()) {
      try {
        task.cancel();
      } catch {
        /* noop */
      }
    }
    renderTasksMap.current.clear();
    renderedScalesMap.current.clear();
    canvasRefsMap.current.clear();
    visiblePagesRef.current.clear();
    docRef.current = null;

    loadPdf(filePath)
      .then(({ doc, pages }) => {
        if (cancelled) return;
        docRef.current = doc;
        setPageInfos(pages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`PDF 로드 실패: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // 초기 fit-to-width: 첫 페이지가 컨테이너 너비에 맞도록 scale 자동 설정
  useLayoutEffect(() => {
    if (pageInfos.length === 0 || !scrollRef.current) return;
    const firstPage = pageInfos[0];
    if (!firstPage || firstPage.width === 0) return;
    const containerWidth = scrollRef.current.clientWidth - SCROLL_PADDING_PX;
    if (containerWidth <= 0) return;
    const initScale = containerWidth / firstPage.width;
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, initScale)));
  }, [pageInfos]);

  // 가로 페이지 혼재 시 초기 가로 스크롤 가운데 정렬 (파일 로드 후 1회만).
  // scale을 deps에 포함해 fit-to-width로 scale이 settle된 다음 cycle에서 동작하도록 함.
  // 사용자 스크롤을 존중하기 위해 didCenterRef로 1회 가드.
  const didCenterRef = useRef(false);
  useEffect(() => {
    didCenterRef.current = false;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scale을 deps에 포함해 fit-to-width settle 후에 fire하도록 의도
  useLayoutEffect(() => {
    if (didCenterRef.current) return;
    if (pageInfos.length === 0 || !scrollRef.current) return;
    const root = scrollRef.current;
    if (root.scrollWidth > root.clientWidth) {
      root.scrollLeft = (root.scrollWidth - root.clientWidth) / 2;
    }
    didCenterRef.current = true;
  }, [pageInfos, scale]);

  // 단일 페이지를 canvas에 렌더 (scale은 인자로 받아 클로저 stale 방지)
  const renderPage = useCallback(
    async (pageIdx: number, targetScale: number): Promise<void> => {
      const doc = docRef.current;
      const canvas = canvasRefsMap.current.get(pageIdx);
      if (!doc || !canvas) return;

      const existing = renderTasksMap.current.get(pageIdx);
      if (existing) {
        try {
          existing.cancel();
        } catch {
          /* noop */
        }
      }

      const page = await doc.getPage(pageIdx + 1);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: targetScale * dpr });
      const cssWidth = viewport.width / dpr;
      const cssHeight = viewport.height / dpr;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const task = page.render({ canvasContext: ctx, viewport });
      renderTasksMap.current.set(pageIdx, task);

      try {
        await task.promise;
        renderedScalesMap.current.set(pageIdx, targetScale);
      } catch {
        // canceled or 렌더 실패 — 무시 (다음 visibility 이벤트에서 재시도)
      } finally {
        renderTasksMap.current.delete(pageIdx);
      }
    },
    [],
  );

  // scale 변경 시 visible 페이지를 즉시 재렌더, 비가시 페이지의 캐시는 stale 표시
  useEffect(() => {
    if (pageInfos.length === 0) return;
    for (const idx of visiblePagesRef.current) {
      renderPage(idx, scale);
    }
    for (const idx of Array.from(renderedScalesMap.current.keys())) {
      if (!visiblePagesRef.current.has(idx)) {
        renderedScalesMap.current.delete(idx);
      }
    }
  }, [scale, pageInfos, renderPage]);

  // IntersectionObserver entry 처리: visibility 맵 + visiblePagesRef + lazy 렌더
  const processEntry = useCallback(
    (entry: IntersectionObserverEntry, visibility: Map<number, number>) => {
      const idx = Number(
        (entry.target as HTMLElement).dataset.pageIndex ?? "0",
      );
      visibility.set(idx, entry.intersectionRatio);
      if (entry.isIntersecting) {
        visiblePagesRef.current.add(idx);
        if (renderedScalesMap.current.get(idx) !== scaleRef.current) {
          renderPage(idx, scaleRef.current);
        }
      } else {
        visiblePagesRef.current.delete(idx);
      }
    },
    [renderPage],
  );

  // IntersectionObserver: 페이지 가시성 추적 + lazy 렌더 + currentPage 갱신
  useEffect(() => {
    if (pageInfos.length === 0 || !scrollRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const root = scrollRef.current;
    const visibility = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) processEntry(entry, visibility);
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

    const pageEls = root.querySelectorAll<HTMLElement>("[data-page-index]");
    for (const el of pageEls) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pageInfos, processEntry]);

  // 스크롤로 currentPage 변경 시 입력 필드 동기화 (입력 중이면 덮어쓰지 않음)
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) return;
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const scrollToPage = useCallback(
    (idx: number) => {
      const total = pageInfos.length;
      if (total === 0 || !scrollRef.current) return;
      const clamped = Math.max(0, Math.min(total - 1, idx));
      setCurrentPage(clamped);
      const pageEl = scrollRef.current.querySelector<HTMLElement>(
        `[data-page-index="${clamped}"]`,
      );
      pageEl?.scrollIntoView({ behavior: "instant", block: "start" });
    },
    [pageInfos.length],
  );

  const submitPageInput = useCallback(() => {
    const total = pageInfos.length;
    if (total === 0) return;
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n) && n >= 1 && n <= total) {
      scrollToPage(n - 1);
    } else {
      setPageInput(String(currentPage + 1));
    }
  }, [pageInfos.length, pageInput, currentPage, scrollToPage]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d+$/.test(value)) {
      setPageInput(value);
    }
  }, []);

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

  const adjustScale = useCallback((delta: number) => {
    setScale((prev) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)));
  }, []);

  const fitToWidth = useCallback(() => {
    if (pageInfos.length === 0 || !scrollRef.current) return;
    const firstPage = pageInfos[0];
    if (!firstPage || firstPage.width === 0) return;
    const containerWidth = scrollRef.current.clientWidth - SCROLL_PADDING_PX;
    if (containerWidth <= 0) return;
    const newScale = containerWidth / firstPage.width;
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)));
  }, [pageInfos]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (isLoading || pageInfos.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
        PDF 로딩 중...
      </div>
    );
  }

  const canPrev = currentPage > 0;
  const canNext = currentPage < pageInfos.length - 1;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid="pdf-viewer"
    >
      <div className="flex items-center justify-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        <button
          type="button"
          onClick={() => scrollToPage(currentPage - 1)}
          disabled={!canPrev}
          className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="이전 페이지"
          data-testid="pdf-prev"
        >
          <ChevronLeft size={14} />
        </button>
        <span
          data-testid="pdf-page-indicator"
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
            data-testid="pdf-page-input"
          />
          <span>/</span>
          <span data-testid="pdf-page-count">{pageInfos.length}</span>
        </span>
        <button
          type="button"
          onClick={() => scrollToPage(currentPage + 1)}
          disabled={!canNext}
          className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="다음 페이지"
          data-testid="pdf-next"
        >
          <ChevronRight size={14} />
        </button>
        <span className="mx-1 text-[var(--color-border)]">|</span>
        <button
          type="button"
          onClick={() => adjustScale(-SCALE_STEP)}
          disabled={scale <= MIN_SCALE}
          className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="축소"
          data-testid="pdf-zoom-out"
        >
          <Minus size={14} />
        </button>
        <span className="tabular-nums w-12 text-center" data-testid="pdf-scale">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => adjustScale(SCALE_STEP)}
          disabled={scale >= MAX_SCALE}
          className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="확대"
          data-testid="pdf-zoom-in"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={fitToWidth}
          className="flex items-center hover:text-[var(--color-text)] transition-colors"
          aria-label="너비 맞춤"
          data-testid="pdf-fit"
        >
          <Maximize size={14} />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-[var(--color-panel-bg)] p-4"
        data-testid="pdf-scroller"
      >
        <div className="flex flex-col gap-4 min-w-max [align-items:safe_center]">
          {pageInfos.map((info, i) => {
            const cssWidth = info.width * scale;
            const cssHeight = info.height * scale;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 페이지 순서는 안정적이고 변하지 않는다
                key={i}
                data-page-index={i}
                className="bg-white shadow-sm"
                data-testid="pdf-page"
                style={{
                  width: `${cssWidth}px`,
                  height: `${cssHeight}px`,
                  contentVisibility: "auto",
                  containIntrinsicSize: `${cssWidth}px ${cssHeight}px`,
                }}
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefsMap.current.set(i, el);
                    else canvasRefsMap.current.delete(i);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
