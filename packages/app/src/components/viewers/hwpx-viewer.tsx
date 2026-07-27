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
import { nextFrame } from "../../lib/frame";
import { type HwpDocument, loadHwpDocument } from "../../lib/rhwp";
import { SearchBar } from "../editor/search-bar";
import { Spinner, ViewerLoading } from "../ui/spinner";
import {
  MAX_SCALE,
  MIN_SCALE,
  SCALE_STEP,
  ViewerToolbar,
} from "./viewer-toolbar";

interface HwpxViewerProps {
  readonly filePath: string;
}

interface PageSize {
  readonly width: number;
  readonly height: number;
}

interface DocState {
  readonly pageCount: number;
  /** 페이지별 배치 크기. 아직 렌더하지 않은 페이지의 자리를 잡는 데 쓴다. */
  readonly sizes: ReadonlyArray<PageSize>;
}

/** 현재 SVG를 유지할 페이지 구간 (양끝 포함). end < start면 비어 있음. */
interface PageRange {
  readonly start: number;
  readonly end: number;
}

interface PageHighlight {
  readonly rect: HwpHighlightRect;
  readonly active: boolean;
}

/** A4 @96dpi — getPageInfo를 못 읽을 때의 자리표시자 크기. */
const DEFAULT_PAGE_SIZE: PageSize = { width: 793.7, height: 1122.5 };
const SCROLL_PADDING_PX = 32; // p-4 양옆
/** 화면에 보이는 페이지 앞뒤로 미리 렌더해둘 페이지 수. */
const RENDER_AHEAD = 2;
/** 이 범위를 벗어난 페이지의 SVG는 캐시에서 버린다 (메모리 상한). */
const KEEP_AHEAD = 6;

const EMPTY_HIGHLIGHTS: ReadonlyArray<PageHighlight> = [];
const EMPTY_SVGS: ReadonlyMap<number, string> = new Map();
const EMPTY_RANGE: PageRange = { start: 0, end: -1 };

/** SVG 루트의 width/height 속성 추출. 하나라도 없으면 null. */
function extractSvgSize(svg: string): PageSize | null {
  const width = svg.match(/<svg\b[^>]*\swidth="([\d.]+)(?:px)?"/i);
  const height = svg.match(/<svg\b[^>]*\sheight="([\d.]+)(?:px)?"/i);
  if (!width?.[1] || !height?.[1]) return null;
  const size = { width: Number(width[1]), height: Number(height[1]) };
  if (size.width <= 0 || size.height <= 0) return null;
  return size;
}

/** getPageInfo(JSON)로 페이지 크기를 읽는다. 실패 시 A4 기본값. */
function readPageSize(doc: HwpDocument, index: number): PageSize {
  try {
    const parsed: unknown = JSON.parse(doc.getPageInfo(index));
    if (typeof parsed === "object" && parsed !== null) {
      const { width, height } = parsed as Record<string, unknown>;
      if (
        typeof width === "number" &&
        width > 0 &&
        typeof height === "number" &&
        height > 0
      ) {
        return { width, height };
      }
    }
  } catch {
    // getPageInfo 미지원/실패 — 기본값으로 자리만 잡고 렌더 시 보정한다
  }
  return DEFAULT_PAGE_SIZE;
}

function renderPage(doc: HwpDocument, index: number): string | null {
  try {
    return doc.renderPageSvg(index);
  } catch {
    return null;
  }
}

/**
 * 페이지 수와 페이지별 크기를 읽고, 첫 페이지만 즉시 렌더한다.
 * 나머지 페이지는 스크롤에 따라 필요할 때 렌더된다 — 수백 쪽짜리 문서를
 * 통째로 렌더하면 SVG 문자열과 DOM 노드가 수백 MB로 불어나 앱은 물론
 * 시스템 전체가 멈춘다.
 */
function readDocOutline(doc: HwpDocument): {
  readonly state: DocState;
  readonly firstSvg: string | null;
} {
  const pageCount = doc.pageCount();
  const sizes: Array<PageSize> = [];
  for (let i = 0; i < pageCount; i += 1) {
    sizes.push(readPageSize(doc, i));
  }

  const firstSvg = pageCount > 0 ? renderPage(doc, 0) : null;
  const measured = firstSvg ? extractSvgSize(firstSvg) : null;
  if (measured) sizes[0] = measured;

  return { state: { pageCount, sizes }, firstSvg };
}

/** 두 크기가 사실상 같은지 (렌더러/메타데이터 간 반올림 오차 허용). */
function isSameSize(a: PageSize, b: PageSize): boolean {
  return (
    Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
  );
}

/** 실제 렌더 크기로 자리표시자 크기를 보정한 새 DocState. 변화 없으면 원본. */
function withCorrectedSize(
  state: DocState | null,
  index: number,
  measured: PageSize,
): DocState | null {
  const known = state?.sizes[index];
  if (!state || !known || isSameSize(known, measured)) return state;
  const sizes = [...state.sizes];
  sizes[index] = measured;
  return { ...state, sizes };
}

/** keep 구간 밖의 SVG를 캐시에서 제거한다. 하나라도 지웠으면 true. */
function evictOutside(
  cache: Map<number, string>,
  keepStart: number,
  keepEnd: number,
): boolean {
  let evicted = false;
  for (const index of Array.from(cache.keys())) {
    if (index < keepStart || index > keepEnd) {
      cache.delete(index);
      evicted = true;
    }
  }
  return evicted;
}

/** 구간 안에서 아직 렌더되지 않은 페이지 인덱스. */
function missingPages(
  cache: ReadonlyMap<number, string>,
  range: PageRange,
): Array<number> {
  const missing: Array<number> = [];
  for (let i = range.start; i <= range.end; i += 1) {
    if (!cache.has(i)) missing.push(i);
  }
  return missing;
}

/** 가장 많이 보이는 페이지 인덱스. */
function mostVisibleIndex(visibility: ReadonlyMap<number, number>): number {
  let bestIdx = 0;
  let bestRatio = -1;
  for (const [idx, ratio] of visibility) {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

/** 중심 구간에 선렌더 여유를 붙여 렌더 대상 구간을 만든다. */
function withRenderAhead(
  first: number,
  last: number,
  pageCount: number,
): PageRange {
  return {
    start: Math.max(0, first - RENDER_AHEAD),
    end: Math.min(pageCount - 1, last + RENDER_AHEAD),
  };
}

function isSameRange(a: PageRange, b: PageRange): boolean {
  return a.start === b.start && a.end === b.end;
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
  /** 아직 렌더되지 않았으면 null — 자리표시자를 보여준다. */
  readonly svg: string | null;
  readonly size: PageSize;
  readonly highlights: ReadonlyArray<PageHighlight>;
}

/**
 * 한 페이지 = SVG(또는 자리표시자) + 검색 하이라이트 오버레이.
 * .hwpx-page에 걸린 `zoom: var(--zoom-scale)`가 오버레이 박스에도 함께
 * 적용되므로, 박스 좌표는 SVG viewBox 좌표를 그대로 쓴다.
 */
function HwpxPage({ index, svg, size, highlights }: HwpxPageProps) {
  return (
    <div
      data-page-index={index}
      className="hwpx-page relative bg-white border border-[var(--color-border)]"
      data-testid="hwpx-page"
      style={{ width: `${size.width}px`, height: `${size.height}px` }}
    >
      {svg ? (
        <SvgContent svg={svg} />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-[var(--color-faint)]"
          data-testid="hwpx-page-placeholder"
        >
          <Spinner size={20} />
        </div>
      )}
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
  const [pageSvgs, setPageSvgs] =
    useState<ReadonlyMap<number, string>>(EMPTY_SVGS);
  const [renderRange, setRenderRange] = useState<PageRange>(EMPTY_RANGE);
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const svgCacheRef = useRef<Map<number, string>>(new Map());
  const visibleRef = useRef<Set<number>>(new Set());

  const search = useHwpxSearch({ doc, resetKey: filePath });
  const {
    visible: searchVisible,
    focusToken,
    close: closeSearch,
  } = useSearchToggle(panelRef, search.clear);

  const pageCount = docState?.pageCount ?? 0;

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: HwpDocument | null = null;

    setIsLoading(true);
    setError(null);
    setCurrentPage(0);
    setScale(1);
    setDocState(null);
    setDoc(null);
    setPageSvgs(EMPTY_SVGS);
    setRenderRange(EMPTY_RANGE);
    svgCacheRef.current.clear();
    visibleRef.current.clear();

    loadHwpDocument(filePath)
      .then((loaded) => {
        if (cancelled) {
          loaded.free();
          return;
        }
        loadedDoc = loaded;
        const { state, firstSvg } = readDocOutline(loaded);
        if (firstSvg !== null) {
          svgCacheRef.current.set(0, firstSvg);
          setPageSvgs(new Map(svgCacheRef.current));
        }
        // 검색(getSelectionRects 등)을 위해 doc 인스턴스를 유지한다.
        // cleanup에서만 free한다.
        setDoc(loaded);
        setDocState(state);
        setRenderRange({
          start: 0,
          end: Math.min(RENDER_AHEAD, state.pageCount - 1),
        });
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

  // 보이는 구간의 페이지를 한 프레임에 하나씩 렌더하고, 멀리 떨어진 페이지의
  // SVG는 버린다. 프레임을 양보하기 때문에 렌더 중에도 스크롤이 반응한다.
  useEffect(() => {
    if (!doc) return;
    const cache = svgCacheRef.current;

    if (
      evictOutside(
        cache,
        renderRange.start - KEEP_AHEAD,
        renderRange.end + KEEP_AHEAD,
      )
    ) {
      setPageSvgs(new Map(cache));
    }

    const missing = missingPages(cache, renderRange);
    if (missing.length === 0) return;

    let cancelled = false;

    const commitPage = (index: number, svg: string): void => {
      cache.set(index, svg);
      setPageSvgs(new Map(cache));
      // 실제 렌더 결과로 자리표시자 크기를 보정한다
      const measured = extractSvgSize(svg);
      if (measured) {
        setDocState((prev) => withCorrectedSize(prev, index, measured));
      }
    };

    const renderMissing = async (): Promise<void> => {
      for (const index of missing) {
        await nextFrame();
        // free()된 문서에 접근하지 않도록 매 재개 시점마다 확인
        if (cancelled) return;
        const svg = renderPage(doc, index);
        if (cancelled) return;
        if (svg !== null) commitPage(index, svg);
      }
    };
    void renderMissing();

    return () => {
      cancelled = true;
    };
  }, [doc, renderRange]);

  // 첫 렌더 직후 가로 스크롤을 가운데로 맞춘다 (가로 페이지 혼재 대응).
  useLayoutEffect(() => {
    if (pageCount === 0 || !scrollRef.current) return;
    const root = scrollRef.current;
    if (root.scrollWidth > root.clientWidth) {
      root.scrollLeft = (root.scrollWidth - root.clientWidth) / 2;
    }
  }, [pageCount]);

  useEffect(() => {
    if (pageCount === 0 || !scrollRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const root = scrollRef.current;
    const pageEls = root.querySelectorAll<HTMLElement>("[data-page-index]");
    const visible = visibleRef.current;
    const visibility = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number(
            (entry.target as HTMLElement).dataset.pageIndex ?? "0",
          );
          visibility.set(idx, entry.intersectionRatio);
          if (entry.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        }

        const bestIdx = mostVisibleIndex(visibility);
        setCurrentPage((prev) => (prev === bestIdx ? prev : bestIdx));

        if (visible.size === 0) return;
        const next = withRenderAhead(
          Math.min(...visible),
          Math.max(...visible),
          pageCount,
        );
        setRenderRange((prev) => (isSameRange(prev, next) ? prev : next));
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
      if (pageCount === 0 || !scrollRef.current) return;
      const clamped = Math.max(0, Math.min(pageCount - 1, idx));
      setCurrentPage(clamped);
      const pageEl = scrollRef.current.querySelector<HTMLElement>(
        `[data-page-index="${clamped}"]`,
      );
      pageEl?.scrollIntoView({ behavior: "instant", block: "start" });
      // IntersectionObserver 콜백을 기다리지 않고 대상 페이지를 먼저 렌더한다
      const next = withRenderAhead(clamped, clamped, pageCount);
      setRenderRange((prev) => (isSameRange(prev, next) ? prev : next));
    },
    [pageCount],
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
    const firstSize = docState?.sizes[0];
    if (!firstSize || firstSize.width === 0 || !scrollRef.current) return;
    const containerWidth = scrollRef.current.clientWidth - SCROLL_PADDING_PX;
    if (containerWidth <= 0) return;
    const newScale = containerWidth / firstSize.width;
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)));
  }, [docState]);

  // 페이지 리스트는 docState/렌더된 SVG/하이라이트가 바뀔 때만 재계산.
  // SVG 자체는 SvgContent memo로 재주입을 막는다.
  const pageList = useMemo(() => {
    if (!docState) return null;
    return docState.sizes.map((size, i) => (
      <HwpxPage
        // biome-ignore lint/suspicious/noArrayIndexKey: 페이지 순서는 안정적이고 변하지 않는다
        key={i}
        index={i}
        svg={pageSvgs.get(i) ?? null}
        size={size}
        highlights={search.highlightsByPage.get(i) ?? EMPTY_HIGHLIGHTS}
      />
    ));
  }, [docState, pageSvgs, search.highlightsByPage]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (isLoading || !docState) {
    return <ViewerLoading label="HWP 로딩 중..." detail="문서를 여는 중" />;
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
      <div className="relative flex-1 overflow-hidden">
        <ViewerToolbar
          currentPage={currentPage}
          pageCount={docState.pageCount}
          scale={scale}
          testIdPrefix="hwpx"
          scrollRef={scrollRef}
          onPageJump={scrollToPage}
          onZoomIn={() => adjustScale(SCALE_STEP)}
          onZoomOut={() => adjustScale(-SCALE_STEP)}
          onFitToWidth={fitToWidth}
          canZoomIn={scale < MAX_SCALE}
          canZoomOut={scale > MIN_SCALE}
        />
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
          indexing={search.indexing}
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
