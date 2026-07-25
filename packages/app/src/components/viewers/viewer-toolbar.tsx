import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAutoHide } from "../../hooks/use-auto-hide";

interface ViewerToolbarProps {
  /** 0-based 현재 페이지 인덱스 */
  readonly currentPage: number;
  readonly pageCount: number;
  /** 1.0 = 100% */
  readonly scale: number;
  /** "hwpx" | "docx" | "pdf" — data-testid 접두어 */
  readonly testIdPrefix: string;
  /**
   * 문서 스크롤 컨테이너. 전달하면 자동 숨김이 활성화된다:
   * 초기 3초 표시 후 숨김, 스크롤 시 재표시 → 멈춤 2.5초 후 다시 숨김.
   */
  readonly scrollRef?: React.RefObject<HTMLElement | null>;
  readonly onPageJump: (idx: number) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFitToWidth: () => void;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
}

/**
 * 모든 문서 뷰어가 공유하는 플로팅 페이지/줌 컨트롤 (데스크 하단 중앙 필).
 * 부모의 relative 컨테이너 안에서 absolute로 띄운다.
 *
 * 페이지 입력 필드의 로컬 상태(입력 중 텍스트)와 키보드 처리는 본 컴포넌트가
 * 자체적으로 관리한다. 부모는 currentPage/pageCount/scale와 콜백만 전달.
 */
export function ViewerToolbar({
  currentPage,
  pageCount,
  scale,
  testIdPrefix,
  scrollRef,
  onPageJump,
  onZoomIn,
  onZoomOut,
  onFitToWidth,
  canZoomIn,
  canZoomOut,
}: ViewerToolbarProps) {
  const [pageInput, setPageInput] = useState("1");
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const { visible, hold, release } = useAutoHide({ scrollRef });

  // 외부 currentPage 변경(스크롤/네비게이션) 시 입력 동기화. 사용자가 입력 중이면 덮어쓰지 않음.
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) return;
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const submitPageInput = useCallback(() => {
    if (pageCount === 0) return;
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
      onPageJump(n - 1);
    } else {
      setPageInput(String(currentPage + 1));
    }
  }, [pageCount, pageInput, currentPage, onPageJump]);

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

  const canPrev = currentPage > 0;
  const canNext = currentPage < pageCount - 1;

  return (
    <div
      className={`absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-[var(--color-float-bg)] px-3.5 py-[7px] text-xs text-[#e5e7eb] shadow-[0_4px_12px_rgba(16,24,40,0.25)] backdrop-blur-[6px] transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      data-testid={`${testIdPrefix}-toolbar`}
      data-visible={visible ? "true" : "false"}
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocusCapture={hold}
      onBlurCapture={release}
    >
      <button
        type="button"
        onClick={() => onPageJump(currentPage - 1)}
        disabled={!canPrev}
        className="flex items-center hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="이전 페이지"
        data-testid={`${testIdPrefix}-prev`}
      >
        <ChevronLeft size={14} />
      </button>
      <span
        data-testid={`${testIdPrefix}-page-indicator`}
        className="flex items-center gap-1 tabular-nums"
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
          className="w-7 bg-transparent text-center border-b border-transparent focus:outline-none focus:border-white/40"
          aria-label="페이지 번호 입력"
          data-testid={`${testIdPrefix}-page-input`}
        />
        <span>/</span>
        <span data-testid={`${testIdPrefix}-page-count`}>{pageCount}</span>
      </span>
      <button
        type="button"
        onClick={() => onPageJump(currentPage + 1)}
        disabled={!canNext}
        className="flex items-center hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="다음 페이지"
        data-testid={`${testIdPrefix}-next`}
      >
        <ChevronRight size={14} />
      </button>
      <span className="h-3 w-px bg-white/25" aria-hidden />
      <button
        type="button"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        className="flex items-center hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="축소"
        data-testid={`${testIdPrefix}-zoom-out`}
      >
        <Minus size={14} />
      </button>
      <span
        className="tabular-nums w-10 text-center"
        data-testid={`${testIdPrefix}-scale`}
      >
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        className="flex items-center hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="확대"
        data-testid={`${testIdPrefix}-zoom-in`}
      >
        <Plus size={14} />
      </button>
      <span className="h-3 w-px bg-white/25" aria-hidden />
      <button
        type="button"
        onClick={onFitToWidth}
        className="flex items-center hover:text-white transition-colors"
        aria-label="너비 맞춤"
        data-testid={`${testIdPrefix}-fit`}
      >
        <Maximize size={14} />
      </button>
    </div>
  );
}

export const SCALE_STEP = 0.25;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4.0;
