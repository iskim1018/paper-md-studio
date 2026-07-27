/**
 * 로딩 스피너.
 *
 * transform(rotate) 기반 CSS 애니메이션이라 컴포지터 스레드에서 돌아간다.
 * 즉 메인 스레드가 무거운 동기 작업(WASM 파싱·SVG 렌더 등)으로 잠깐 막혀도
 * 계속 회전한다 — "앱이 죽은 건지 작업 중인지" 구분되지 않던 문제를 막는다.
 */

interface SpinnerProps {
  readonly size?: number;
  readonly className?: string;
}

export function Spinner({ size = 18, className = "" }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`.trim()}
      role="img"
      aria-label="로딩 중"
      data-testid="spinner"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface ViewerLoadingProps {
  readonly label: string;
  /** 진행 상황 등 보조 문구. 없으면 표시하지 않는다. */
  readonly detail?: string;
}

/** 뷰어 패널 전체를 채우는 로딩 상태. */
export function ViewerLoading({ label, detail }: ViewerLoadingProps) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2.5 text-sm text-[var(--color-muted)]"
      data-testid="viewer-loading"
    >
      <Spinner size={22} className="text-[var(--color-accent)]" />
      <p>{label}</p>
      {detail && <p className="text-xs text-[var(--color-faint)]">{detail}</p>}
    </div>
  );
}
