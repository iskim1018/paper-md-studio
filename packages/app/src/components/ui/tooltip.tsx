import { type ReactNode, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  /** 툴팁 본문 (필수) */
  readonly content: string;
  /** 우측에 병기할 단축키 라벨 (예: "⌘B") */
  readonly shortcut?: string;
  /** 툴팁이 열리는 방향. 헤더처럼 상단 요소는 "bottom" 권장 */
  readonly side?: "top" | "bottom";
  readonly children: ReactNode;
}

interface TooltipPosition {
  readonly x: number;
  readonly y: number;
}

/** 툴팁 중심점이 뷰포트 밖으로 나가지 않도록 여백 확보(px) */
const VIEWPORT_MARGIN = 8;
/** 트리거와 툴팁 사이 간격(px) */
const OFFSET = 6;

/**
 * 경량 툴팁. hover/키보드 포커스 시 지연 후 표시된다.
 *
 * 말풍선은 document.body로 portal 렌더링한다 — react-resizable-panels의
 * Panel이 overflow:hidden이라 absolute 포지셔닝으로는 패널 경계에서
 * 잘리기 때문. 스크린리더는 트리거 자체의 aria-label/텍스트를 읽도록
 * 말풍선은 aria-hidden 처리한다.
 */
export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  children,
}: TooltipProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const show = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const x = Math.min(
      Math.max(centerX, VIEWPORT_MARGIN),
      window.innerWidth - VIEWPORT_MARGIN,
    );
    const y = side === "bottom" ? rect.bottom + OFFSET : rect.top - OFFSET;
    setPosition({ x, y });
  }, [side]);

  const hide = useCallback(() => setPosition(null), []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 시각적 hover 힌트 전용 래퍼. 실제 상호작용·포커스는 자식 버튼이 담당하며 focus/blur는 자식에서 버블된 이벤트만 사용
    <span
      ref={wrapperRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {position &&
        createPortal(
          <span
            role="presentation"
            aria-hidden="true"
            data-testid="tooltip"
            className={`tooltip-bubble pointer-events-none fixed z-[90] whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] shadow-md ${
              side === "bottom"
                ? "-translate-x-1/2"
                : "-translate-x-1/2 -translate-y-full"
            }`}
            style={{ left: position.x, top: position.y }}
          >
            {content}
            {shortcut && (
              <kbd className="ml-1.5 rounded border border-[var(--color-border)] bg-[var(--color-panel-bg)] px-1 py-px font-sans text-[10px] text-[var(--color-muted)]">
                {shortcut}
              </kbd>
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}
