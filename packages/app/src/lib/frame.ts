/**
 * 메인 스레드 양보 유틸리티.
 *
 * WASM 렌더/인덱싱처럼 동기 비용이 큰 작업을 프레임 단위로 쪼갤 때 사용한다.
 * 작업 사이에 브라우저가 페인트할 틈을 줘야 스피너가 돌고 스크롤이 반응한다.
 */

const FALLBACK_DELAY_MS = 16;

/** 콜백을 다음 프레임에 예약하고, 취소 함수를 반환한다. */
export function scheduleFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => fn());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, FALLBACK_DELAY_MS);
  return () => clearTimeout(id);
}

/** 다음 프레임까지 대기한다. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    scheduleFrame(resolve);
  });
}
