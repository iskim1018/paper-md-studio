import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [pageInput, setPageInput] = useState("1");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: HwpDocument | null = null;

    setIsLoading(true);
    setError(null);
    setCurrentPage(0);
    setPageInput("1");
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

  // 스크롤로 currentPage가 바뀌면 입력 필드도 동기화. 단, 사용자가 입력 중이면 덮어쓰지 않는다.
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) return;
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const scrollToPage = useCallback(
    (idx: number) => {
      if (!docState || !scrollRef.current) return;
      const clamped = Math.max(0, Math.min(docState.pageCount - 1, idx));
      // 클릭/입력 직후 즉각적인 인디케이터 반응을 위해 낙관적으로 currentPage를 먼저 갱신.
      // 스크롤 후 IntersectionObserver가 다시 fire되어 동일 값으로 수렴.
      setCurrentPage(clamped);
      const pageEl = scrollRef.current.querySelector<HTMLElement>(
        `[data-page-index="${clamped}"]`,
      );
      // smooth 애니메이션은 명시적 네비게이션을 ~500ms 지연시켜 사용자가 답답함을 느낀다.
      // 휠 스크롤은 사용자가 직접 제어하므로 이 변경의 영향을 받지 않는다.
      pageEl?.scrollIntoView({ behavior: "instant", block: "start" });
    },
    [docState],
  );

  const submitPageInput = useCallback(() => {
    if (!docState) return;
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n) && n >= 1 && n <= docState.pageCount) {
      scrollToPage(n - 1);
    } else {
      // 범위 밖이거나 숫자가 아닌 입력은 현재 페이지로 복원
      setPageInput(String(currentPage + 1));
    }
  }, [docState, pageInput, currentPage, scrollToPage]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    // 숫자만 허용 (빈 문자열도 허용해 typing 중에는 자유롭게)
    const value = e.target.value;
    if (value === "" || /^\d+$/.test(value)) {
      setPageInput(value);
    }
  }, []);

  // Enter/Esc로 키보드 핸들러가 명시적으로 처리한 경우 onBlur의 자동 submit을 건너뛴다.
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

  // 페이지 리스트는 docState가 바뀔 때만 재계산.
  // currentPage/pageInput 변경에 영향받지 않아 React가 페이지 서브트리 reconciliation을 스킵한다.
  // 50+ 페이지의 큰 SVG를 매 키 입력/클릭마다 재조정하던 lag을 제거.
  const pageList = useMemo(() => {
    if (!docState) return null;
    return docState.pages.map((svg, i) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: 페이지 순서는 안정적이고 변하지 않는다
        key={i}
        data-page-index={i}
        className="hwpx-page bg-white shadow-sm"
        data-testid="hwpx-page"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: WASM 출력 SVG (외부 입력 임베드 없음)
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    ));
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

  const canPrev = currentPage > 0;
  const canNext = currentPage < docState.pageCount - 1;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid="hwpx-viewer"
    >
      <div className="flex items-center justify-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        <button
          type="button"
          onClick={() => scrollToPage(currentPage - 1)}
          disabled={!canPrev}
          className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="이전 페이지"
          data-testid="hwpx-prev"
        >
          <ChevronLeft size={14} />
        </button>
        <span
          data-testid="hwpx-page-indicator"
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
            data-testid="hwpx-page-input"
          />
          <span>/</span>
          <span data-testid="hwpx-page-count">{docState.pageCount}</span>
        </span>
        <button
          type="button"
          onClick={() => scrollToPage(currentPage + 1)}
          disabled={!canNext}
          className="flex items-center hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="다음 페이지"
          data-testid="hwpx-next"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-[var(--color-panel-bg)] p-4"
        data-testid="hwpx-scroller"
      >
        <div className="flex flex-col gap-4 min-w-max [align-items:safe_center]">
          {pageList}
        </div>
      </div>
    </div>
  );
}
