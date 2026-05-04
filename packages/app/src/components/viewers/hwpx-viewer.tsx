import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type HwpDocument, loadHwpDocument } from "../../lib/rhwp";

interface HwpxViewerProps {
  readonly filePath: string;
}

interface DocState {
  readonly pageCount: number;
  readonly pages: ReadonlyArray<string>;
}

function renderAllPages(doc: HwpDocument): DocState {
  const pageCount = doc.pageCount();
  const pages: Array<string> = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(doc.renderPageSvg(i));
  }
  return { pageCount, pages };
}

export function HwpxViewer({ filePath }: HwpxViewerProps) {
  const [docState, setDocState] = useState<DocState | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: HwpDocument | null = null;

    setIsLoading(true);
    setError(null);
    setCurrentPage(0);
    setDocState(null);

    loadHwpDocument(filePath)
      .then((doc) => {
        if (cancelled) {
          doc.free();
          return;
        }
        loadedDoc = doc;
        setDocState(renderAllPages(doc));
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

  // 첫 렌더 직후 가로 스크롤을 가운데로 맞춘다.
  // 가로 페이지가 일부 섞여 있는 문서에서 좌우 어느 쪽으로도 치우치지 않게 시작.
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
        setCurrentPage(bestIdx);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    for (const el of pageEls) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [docState]);

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

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid="hwpx-viewer"
    >
      <div className="flex items-center justify-center border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        <span data-testid="hwpx-page-indicator">
          {currentPage + 1} / {docState.pageCount}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-[var(--color-panel-bg)] p-4"
        data-testid="hwpx-scroller"
      >
        <div className="flex flex-col gap-4 min-w-max [align-items:safe_center]">
          {docState.pages.map((svg, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 페이지 순서는 안정적이고 변하지 않는다
              key={i}
              data-page-index={i}
              className="hwpx-page bg-white shadow-sm"
              data-testid="hwpx-page"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: WASM 출력 SVG (외부 입력 임베드 없음)
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
