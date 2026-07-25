import logoUrl from "../../assets/logo.png";

interface LogoSymbolProps {
  /** 심볼 한 변 크기(px) */
  readonly size: number;
  readonly className?: string;
}

/**
 * 앱 로고(946×946 PNG)에서 P 심볼 영역만 CSS 크롭으로 표시.
 * 크롭 기준값(200% / 57% 22%)은 design_handoff 시안과 동일.
 */
export function LogoSymbol({ size, className = "" }: LogoSymbolProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="logo-symbol"
      className={`inline-block shrink-0 bg-no-repeat ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${logoUrl})`,
        backgroundSize: "200%",
        backgroundPosition: "57% 22%",
      }}
    />
  );
}
