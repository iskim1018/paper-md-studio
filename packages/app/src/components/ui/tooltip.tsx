import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

/** 트리거 기준 위치. 말풍선의 최종 left는 폭을 재고 나서 정한다. */
interface TooltipAnchor {
  readonly centerX: number;
  readonly y: number;
}

/** 말풍선 전체가 뷰포트 안에 들어오도록 확보하는 여백(px) */
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
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  const show = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({
      centerX: rect.left + rect.width / 2,
      y: side === "bottom" ? rect.bottom + OFFSET : rect.top - OFFSET,
    });
    setLeft(null); // 위치가 바뀌었으니 폭을 다시 재서 정한다
  }, [side]);

  const hide = useCallback(() => {
    setAnchor(null);
    setLeft(null);
  }, []);

  // 말풍선 '전체'가 화면 안에 들어오도록 실제 폭을 재서 left를 정한다.
  // 중심점만 clamp하면 폭의 절반이 화면 밖으로 나가 잘린다(기존 버그).
  // paint 전에 실행되므로 위치가 튀어 보이지 않는다.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const width = bubble.offsetWidth;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
    const desired = anchor.centerX - width / 2;
    setLeft(Math.max(VIEWPORT_MARGIN, Math.min(desired, maxLeft)));
  }, [anchor]);

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
      {anchor &&
        createPortal(
          <span
            ref={bubbleRef}
            role="presentation"
            aria-hidden="true"
            data-testid="tooltip"
            className={`tooltip-bubble pointer-events-none fixed z-[90] whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] shadow-md ${
              side === "bottom" ? "" : "-translate-y-full"
            }`}
            style={{
              // left가 정해지기 전(폭 측정용 1회)에는 그리지 않는다
              left: left ?? anchor.centerX,
              top: anchor.y,
              visibility: left === null ? "hidden" : "visible",
            }}
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
