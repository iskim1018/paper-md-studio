import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { readFileAsBytes } from "../../lib/file-reader";
import { ViewerLoading } from "../ui/spinner";
import {
  MAX_SCALE,
  MIN_SCALE,
  SCALE_STEP,
  ViewerToolbar,
} from "./viewer-toolbar";

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

const SCROLL_PADDING_PX = 32; // p-4 양옆

async function loadPdf(filePath: string): Promise<{
  doc: PdfDocument;
  pages: Array<PageInfo>;
}> {
  // legacy 빌드 사용 — modern 빌드(6.x)는 Iterator 헬퍼(Safari 18.4+)·
  // Uint8Array.fromBase64(18.2+)를 폴리필 없이 참조해, minimumSystemVersion 12.0
  // (macOS 12 는 Safari 17.6 이 상한) 범위의 WKWebView 에서 로드 자체가 깨진다.
  // legacy 빌드는 core-js 폴리필(es.iterator.*, es.uint8-array.from-base64)을 내장.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDocument | null>(null);
  const canvasRefsMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderedScalesMap = useRef<Map<number, number>>(new Map());
  const renderTasksMap = useRef<Map<number, RenderTask>>(new Map());
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const scaleRef = useRef(scale);

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
    setScale(1);

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

  // 가로 페이지 혼재 시 초기 가로 스크롤 가운데 정렬 (파일 로드 후 1회만)
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
        // canceled or 렌더 실패 — 무시
      } finally {
        renderTasksMap.current.delete(pageIdx);
      }
    },
    [],
  );

  // scale 변경 시 visible 페이지 즉시 재렌더, 비가시는 캐시 stale
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
    return <ViewerLoading label="PDF 로딩 중..." />;
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid="pdf-viewer"
    >
      <div className="relative flex-1 overflow-hidden">
        <ViewerToolbar
          currentPage={currentPage}
          pageCount={pageInfos.length}
          scale={scale}
          testIdPrefix="pdf"
          scrollRef={scrollRef}
          onPageJump={scrollToPage}
          onZoomIn={() => adjustScale(SCALE_STEP)}
          onZoomOut={() => adjustScale(-SCALE_STEP)}
          onFitToWidth={fitToWidth}
          canZoomIn={scale < MAX_SCALE}
          canZoomOut={scale > MIN_SCALE}
        />
        <div
          ref={scrollRef}
          className="h-full overflow-auto bg-[var(--color-panel-bg)] p-4"
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
                  className="bg-white border border-[var(--color-border)]"
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
    </div>
  );
}
