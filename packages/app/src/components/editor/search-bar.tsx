import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TextSearchState } from "../../hooks/use-text-search";
import { Spinner } from "../ui/spinner";

interface SearchBarProps extends TextSearchState {
  readonly visible: boolean;
  /**
   * 외부에서 검색창에 다시 포커스를 요청할 때마다 값을 증가시키는 토큰.
   * 검색창이 이미 열려 있는 상태에서 Cmd+F를 다시 눌렀을 때 input에
   * 재포커스시키기 위한 트리거.
   */
  readonly focusToken: number;
  readonly onClose: () => void;
  /**
   * 검색용 인덱스를 준비하는 중이면 true. HWPX 뷰어처럼 첫 검색 시점에
   * 인덱스를 만드는 경우, 결과 0건과 "아직 준비 중"을 구분해 보여준다.
   */
  readonly indexing?: boolean;
}

/**
 * 텍스트 검색 바. 컨테이너 상단에 absolute로 띄워 사용한다.
 * - 표시되면 input에 자동 포커스
 * - Enter = next, Shift+Enter = prev, Esc = close
 * - data-search-ui 속성으로 useTextSearch의 TreeWalker가 자기 자신을 검색
 *   대상에서 제외하게 한다.
 */
export function SearchBar({
  visible,
  focusToken,
  query,
  matches,
  activeIndex,
  setQuery,
  next,
  prev,
  onClose,
  indexing = false,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      // 다음 paint 후 포커스 (display 전환 직후 포커스 안전).
      // focusToken deps 덕분에 visible이 이미 true여도 토큰이 바뀌면
      // 다시 호출되어 검색창에 재포커스된다.
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [visible, focusToken]);

  if (!visible) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    }
  };

  const counter = matches === 0 ? "0/0" : `${activeIndex + 1}/${matches}`;

  return (
    <div
      data-search-ui
      data-testid="text-search-bar"
      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 shadow-md"
    >
      <Search size={14} className="text-[var(--color-muted)]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="검색"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-40 bg-transparent text-sm outline-none placeholder:text-[var(--color-muted)]"
      />
      <span
        className="flex select-none items-center gap-1 px-1 text-xs text-[var(--color-muted)]"
        data-testid="text-search-counter"
      >
        {indexing ? (
          <>
            <Spinner size={11} />
            준비 중
          </>
        ) : (
          counter
        )}
      </span>
      <button
        type="button"
        onClick={prev}
        disabled={matches === 0}
        className="rounded p-0.5 hover:bg-[var(--color-border)] disabled:opacity-30"
        aria-label="이전 결과"
        title="이전 결과 (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        onClick={next}
        disabled={matches === 0}
        className="rounded p-0.5 hover:bg-[var(--color-border)] disabled:opacity-30"
        aria-label="다음 결과"
        title="다음 결과 (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 hover:bg-[var(--color-border)]"
        aria-label="검색 닫기"
        title="닫기 (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
