import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type HwpHighlightRect,
  useHwpxSearch,
} from "../../hooks/use-hwpx-search";
import { useSearchToggle } from "../../hooks/use-search-toggle";
import { type HwpDocument, loadHwpDocument } from "../../lib/rhwp";
import { SearchBar } from "../editor/search-bar";
import {
  MAX_SCALE,
  MIN_SCALE,
  SCALE_STEP,
  ViewerToolbar,
} from "./viewer-toolbar";

interface HwpxViewerProps {
  readonly filePath: string;
}

interface DocState {
  readonly pageCount: number;
  readonly pages: ReadonlyArray<string>;
  readonly firstPageWidth: number; // fit-to-width 계산용
}

interface PageHighlight {
  readonly rect: HwpHighlightRect;
  readonly active: boolean;
}

const DEFAULT_PAGE_WIDTH = 595; // A4 fallback (px)
const SCROLL_PADDING_PX = 32; // p-4 양옆
const EMPTY_HIGHLIGHTS: ReadonlyArray<PageHighlight> = [];

/** SVG 루트의 width 속성 추출. 실패 시 기본값. */
function extractSvgWidth(svg: string): number {
  const m = svg.match(/<svg\b[^>]*\swidth="([\d.]+)(?:px)?"/i);
  return m ? Number(m[1]) : DEFAULT_PAGE_WIDTH;
}

function renderAllPages(doc: HwpDocument): DocState {
  const pageCount = doc.pageCount();
  const pages: Array<string> = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(doc.renderPageSvg(i));
  }
  const firstPageWidth =
    pages.length > 0 && pages[0]
      ? extractSvgWidth(pages[0])
      : DEFAULT_PAGE_WIDTH;
  return { pageCount, pages, firstPageWidth };
}

/**
 * SVG 콘텐츠는 svg 문자열이 같으면 재주입하지 않도록 memo한다. 검색
 * 하이라이트가 바뀔 때마다 innerHTML을 다시 파싱하면 비용이 크다.
 */
const SvgContent = memo(function SvgContent({ svg }: { svg: string }) {
  return (
    <div
      className="block"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: WASM 출력 SVG (외부 입력 임베드 없음)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

interface HwpxPageProps {
  readonly index: number;
  readonly svg: string;
  readonly highlights: ReadonlyArray<PageHighlight>;
}

/**
 * 한 페이지 = SVG + 검색 하이라이트 오버레이. .hwpx-page에 걸린
 * `zoom: var(--zoom-scale)`가 오버레이 박스에도 함께 적용되므로,
 * 박스 좌표는 SVG viewBox 좌표를 그대로 쓴다 (별도 scale 곱셈 불필요).
 */
function HwpxPage({ index, svg, highlights }: HwpxPageProps) {
  return (
    <div
      data-page-index={index}
      className="hwpx-page relative bg-white shadow-sm"
      data-testid="hwpx-page"
    >
      <SvgContent svg={svg} />
      {highlights.length > 0 && (
        <div className="hwpx-search-overlay" aria-hidden="true">
          {highlights.map((h, hi) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rect 순서는 안정적
              key={hi}
              className={
                h.active
                  ? "hwpx-search-highlight hwpx-search-highlight-active"
                  : "hwpx-search-highlight"
              }
              style={{
                left: `${h.rect.x}px`,
                top: `${h.rect.y}px`,
                width: `${h.rect.width}px`,
                height: `${h.rect.height}px`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function HwpxViewer({ filePath }: HwpxViewerProps) {
  const [docState, setDocState] = useState<DocState | null>(null);
  const [doc, setDoc] = useState<HwpDocument | null>(null);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const search = useHwpxSearch({ doc, resetKey: filePath });
  const {
    visible: searchVisible,
    focusToken,
    close: closeSearch,
  } = useSearchToggle(panelRef, search.clear);

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: HwpDocument | null = null;

    setIsLoading(true);
    setError(null);
    setCurrentPage(0);
    setScale(1);
    setDocState(null);
    setDoc(null);

    loadHwpDocument(filePath)
      .then((loaded) => {
        if (cancelled) {
          loaded.free();
          return;
        }
        loadedDoc = loaded;
        // 검색(searchText/getSelectionRects)을 위해 doc 인스턴스를 유지한다.
        // 과거에는 renderAllPages 직후 free했지만, 이제 cleanup에서만 free한다.
        setDoc(loaded);
        setDocState(renderAllPages(loaded));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`HWP 로드 실패: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (loadedDoc) loadedDoc.free();
    };
  }, [filePath]);

  // 첫 렌더 직후 가로 스크롤을 가운데로 맞춘다 (가로 페이지 혼재 대응).
  useLayoutEffect(() => {
    if (!docState || !scrollRef.current) return;
    const root = scrollRef.current;
    if (root.scrollWidth > root.clientWidth) {
      root.scrollLeft = (root.scrollWidth - root.clientWidth) / 2;
    }
  }, [docState]);

  useEffect(() => {
    if (!docState || !scrollRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const root = scrollRef.current;
    const pageEls = root.querySelectorAll<HTMLElement>("[data-page-index]");

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
  }, [docState]);

  const scrollToPage = useCallback(
    (idx: number) => {
      if (!docState || !scrollRef.current) return;
      const clamped = Math.max(0, Math.min(docState.pageCount - 1, idx));
      setCurrentPage(clamped);
      const pageEl = scrollRef.current.querySelector<HTMLElement>(
        `[data-page-index="${clamped}"]`,
      );
      pageEl?.scrollIntoView({ behavior: "instant", block: "start" });
    },
    [docState],
  );

  // 검색 active 매치가 있는 페이지로 스크롤
  useEffect(() => {
    if (search.activePageIndex == null) return;
    scrollToPage(search.activePageIndex);
  }, [search.activePageIndex, scrollToPage]);

  const adjustScale = useCallback((delta: number) => {
    setScale((prev) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)));
  }, []);

  const fitToWidth = useCallback(() => {
    if (!docState || !scrollRef.current) return;
    if (docState.firstPageWidth === 0) return;
    const containerWidth = scrollRef.current.clientWidth - SCROLL_PADDING_PX;
    if (containerWidth <= 0) return;
    const newScale = containerWidth / docState.firstPageWidth;
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)));
  }, [docState]);

  // 페이지 리스트는 docState/하이라이트가 바뀔 때만 재계산. SVG 자체는
  // SvgContent memo로 재주입을 막으므로, 하이라이트 변경 시 오버레이만 갱신된다.
  const pageList = useMemo(() => {
    if (!docState) return null;
    return docState.pages.map((svg, i) => (
      <HwpxPage
        // biome-ignore lint/suspicious/noArrayIndexKey: 페이지 순서는 안정적이고 변하지 않는다
        key={i}
        index={i}
        svg={svg}
        highlights={search.highlightsByPage.get(i) ?? EMPTY_HIGHLIGHTS}
      />
    ));
  }, [docState, search.highlightsByPage]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (isLoading || !docState) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
        HWP 로딩 중...
      </div>
    );
  }

  // CSS 변수로 zoom scale을 전달. 자식 .hwpx-page에 CSS rule로 적용 (styles.css).
  const containerStyle = {
    "--zoom-scale": scale,
  } as CSSProperties;

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col overflow-hidden"
      data-testid="hwpx-viewer"
      tabIndex={-1}
    >
      <ViewerToolbar
        currentPage={currentPage}
        pageCount={docState.pageCount}
        scale={scale}
        testIdPrefix="hwpx"
        onPageJump={scrollToPage}
        onZoomIn={() => adjustScale(SCALE_STEP)}
        onZoomOut={() => adjustScale(-SCALE_STEP)}
        onFitToWidth={fitToWidth}
        canZoomIn={scale < MAX_SCALE}
        canZoomOut={scale > MIN_SCALE}
      />
      <div className="relative flex-1 overflow-hidden">
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
          data-testid="hwpx-scroller"
          style={containerStyle}
        >
          <div className="flex flex-col gap-4 min-w-max [align-items:safe_center]">
            {pageList}
          </div>
        </div>
      </div>
    </div>
  );
}
