import { useCallback, useEffect, useRef, useState } from "react";

/** 마운트 직후 유지 시간(ms) — 도구 위치를 인지시킨 뒤 숨김 */
export const AUTO_HIDE_INITIAL_MS = 3000;
/** 스크롤 멈춤·포인터 이탈 후 숨김까지의 지연(ms) */
export const AUTO_HIDE_DELAY_MS = 2500;

interface UseAutoHideOptions {
  /** 스크롤을 감지할 컨테이너. 스크롤 시 다시 표시된다. */
  readonly scrollRef?: React.RefObject<HTMLElement | null>;
  readonly initialVisibleMs?: number;
  readonly hideDelayMs?: number;
}

export interface AutoHideState {
  readonly visible: boolean;
  /** 포인터 진입/포커스 시 호출 — 숨김 타이머를 멈추고 계속 표시 */
  hold: () => void;
  /** 포인터 이탈/블러 시 호출 — 지연 후 다시 숨김 */
  release: () => void;
}

/**
 * 플로팅 컨트롤 자동 숨김 상태.
 *
 * - 마운트 직후 initialVisibleMs 동안 표시 후 숨김
 * - scrollRef 컨테이너 스크롤 시 재표시, 멈추면 hideDelayMs 후 숨김
 * - hold() 중(호버·포커스)에는 타이머가 만료돼도 숨기지 않음
 */
export function useAutoHide({
  scrollRef,
  initialVisibleMs = AUTO_HIDE_INITIAL_MS,
  hideDelayMs = AUTO_HIDE_DELAY_MS,
}: UseAutoHideOptions = {}): AutoHideState {
  const [visible, setVisible] = useState(true);
  const heldRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(
    (delay: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!heldRef.current) setVisible(false);
      }, delay);
    },
    [clearTimer],
  );

  // 초기 표시 후 자동 숨김
  useEffect(() => {
    scheduleHide(initialVisibleMs);
    return clearTimer;
  }, [scheduleHide, clearTimer, initialVisibleMs]);

  // 스크롤 시 재표시 → 멈춤 후 숨김
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const onScroll = () => {
      setVisible(true);
      scheduleHide(hideDelayMs);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, scheduleHide, hideDelayMs]);

  const hold = useCallback(() => {
    heldRef.current = true;
    clearTimer();
    setVisible(true);
  }, [clearTimer]);

  const release = useCallback(() => {
    heldRef.current = false;
    scheduleHide(hideDelayMs);
  }, [scheduleHide, hideDelayMs]);

  return { visible, hold, release };
}
