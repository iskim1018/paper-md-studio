import { PanelResizeHandle } from "react-resizable-panels";

/**
 * 패널 너비 조절 핸들.
 *
 * 굵은 회색선 하나로는 "구분선"인지 "조절 가능한 손잡이"인지 구분되지
 * 않아, 평소에도 옅은 그립 점을 노출해 조작 가능함을 알린다. 실제 상태
 * 전환(hover/drag)과 커서, 키보드 조작(화살표 키)은 라이브러리가 담당하고
 * 여기서는 시각적 어포던스만 얹는다.
 *
 * hitAreaMargins로 잡히는 범위를 시각 두께(7px)보다 넓혀, 얇게 보이면서도
 * 조준은 쉽도록 한다. coarse는 터치·트랙패드처럼 정밀도가 낮은 입력용이다.
 */
export function ResizeHandle() {
  return (
    <PanelResizeHandle
      className="panel-resize-handle"
      hitAreaMargins={{ coarse: 16, fine: 8 }}
      aria-label="패널 너비 조절"
      data-testid="panel-resize-handle"
    >
      <span className="panel-resize-grip" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </PanelResizeHandle>
  );
}
