import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePanelSearch } from "../../hooks/use-panel-search";
import {
  injectPageNumbers,
  preprocessDocxPageFields,
} from "../../lib/docx-page-fields";
import { readFileAsBytes } from "../../lib/file-reader";
import { SearchBar } from "../editor/search-bar";
import {
  MAX_SCALE,
  MIN_SCALE,
  SCALE_STEP,
  ViewerToolbar,
} from "./viewer-toolbar";

interface DocxViewerProps {
  readonly filePath: string;
}

const DOCX_PAGE_CLASS = "docx";
const DEFAULT_PAGE_WIDTH = 595;
const SCROLL_PADDING_PX = 32;

interface LoadResult {
  readonly pageCount: number;
  readonly firstPageWidth: number;
}

/** docx-preview가 section.docx에 인라인 style로 부여한 width 추출. */
function extractFirstPageWidth(container: HTMLElement): number {
  const first = container.querySelector<HTMLElement>(
    `section.${DOCX_PAGE_CLASS}`,
  );
  if (!first) return DEFAULT_PAGE_WIDTH;
  const styleWidth = first.style.width;
  const match = styleWidth.match(/^([\d.]+)px$/);
  if (match?.[1]) {
    return Number(match[1]);
  }
  return first.offsetWidth || DEFAULT_PAGE_WIDTH;
}

async function loadDocxIntoContainer(
  filePath: string,
  container: HTMLElement,
): Promise<LoadResult> {
  const bytes = await readFileAsBytes(filePath.normalize("NFC"));
  const rawBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const arrayBuffer = await preprocessDocxPageFields(rawBuffer);

  container.innerHTML = "";

  const docx = await import("docx-preview");
  await docx.renderAsync(arrayBuffer, container, undefined, {
    inWrapper: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
  });

  const pages = container.querySelectorAll<HTMLElement>(
    `section.${DOCX_PAGE_CLASS}`,
  );
  pages.forEach((p, i) => {
    p.dataset.pageIndex = String(i);
  });

  injectPageNumbers(container, pages.length);

  return {
    pageCount: pages.length,
    firstPageWidth: extractFirstPageWidth(container),
  };
}

export function DocxViewer({ filePath }: DocxViewerProps) {
  const [pageCount, setPageCount] = useState(0);
  const [firstPageWidth, setFirstPageWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 패널 전체에 Cmd+F 이벤트 경계 + scrollRef를 검색 대상으로 지정
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    visible: searchVisible,
    focusToken,
    search,
    close: closeSearch,
  } = usePanelSearch({
    containerRef: panelRef,
    contentRef: scrollRef,
    resetKey: pageCount,
  });

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setCurrentPage(0);
    setScale(1);
    setPageCount(0);

    const container = containerRef.current;
    if (!container) {
      setIsLoading(false);
      return;
    }

    loadDocxIntoContainer(filePath, container)
      .then(({ pageCount: count, firstPageWidth: width }) => {
        if (cancelled) {
          container.innerHTML = "";
          return;
        }
        setPageCount(count);
        setFirstPageWidth(width || DEFAULT_PAGE_WIDTH);
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

  const scrollToPage = useCallback(
    (idx: number) => {
      if (!containerRef.current) return;
      const clamped = Math.max(0, Math.min(pageCount - 1, idx));
      setCurrentPage(clamped);
      const pageEl = containerRef.current.querySelector<HTMLElement>(
        `section.${DOCX_PAGE_CLASS}[data-page-index="${clamped}"]`,
      );
      pageEl?.scrollIntoView({ behavior: "instant", block: "start" });
    },
    [pageCount],
  );

  const adjustScale = useCallback((delta: number) => {
    setScale((prev) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)));
  }, []);

  const fitToWidth = useCallback(() => {
    if (pageCount === 0 || !scrollRef.current || firstPageWidth === 0) return;
    const containerWidth = scrollRef.current.clientWidth - SCROLL_PADDING_PX;
    if (containerWidth <= 0) return;
    const newScale = containerWidth / firstPageWidth;
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)));
  }, [pageCount, firstPageWidth]);

  const showHeader = pageCount > 0;

  // CSS 변수로 zoom scale을 전달. 자식 section.docx에 CSS rule로 적용 (styles.css).
  const scrollerStyle = {
    "--zoom-scale": scale,
  } as CSSProperties;

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col overflow-hidden"
      data-testid="docx-viewer"
      tabIndex={-1}
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
      {/*
        스크롤 컨테이너: docx-preview 실행 결과 DOM이 살아 있어야 하므로
        loading/error 상태에서도 마운트는 유지하고 visually hidden으로만 처리.
        SearchBar는 scrollable 영역 우상단에, 플로팅 컨트롤은 하단 중앙에 absolute 고정.
      */}
      <div
        className={`relative flex-1 overflow-hidden ${showHeader ? "" : "hidden"}`}
      >
        {!error && !isLoading && showHeader && (
          <ViewerToolbar
            currentPage={currentPage}
            pageCount={pageCount}
            scale={scale}
            testIdPrefix="docx"
            scrollRef={scrollRef}
            onPageJump={scrollToPage}
            onZoomIn={() => adjustScale(SCALE_STEP)}
            onZoomOut={() => adjustScale(-SCALE_STEP)}
            onFitToWidth={fitToWidth}
            canZoomIn={scale < MAX_SCALE}
            canZoomOut={scale > MIN_SCALE}
          />
        )}
        <SearchBar
          visible={searchVisible}
          focusToken={focusToken}
          query={search.query}
          matches={search.matches}
          activeIndex={search.activeIndex}
          setQuery={search.setQuery}
          next={search.next}
          prev={search.prev}
          clear={search.clear}
          onClose={closeSearch}
        />
        <div
          ref={scrollRef}
          className="h-full overflow-auto bg-[var(--color-panel-bg)] p-4"
          data-testid="docx-scroller"
          style={scrollerStyle}
        >
          <div
            ref={containerRef}
            className="docx-page-container flex flex-col gap-4 min-w-max [align-items:safe_center]"
          />
        </div>
      </div>
    </div>
  );
}
