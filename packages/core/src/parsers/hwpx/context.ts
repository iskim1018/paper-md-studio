import type { HwpxHeader } from "./header.js";
import type { ImageCollector } from "./images.js";
import type { InlinePlacement } from "./inline-builder.js";
import type { XmlNode } from "./xml.js";

/**
 * 글상자·각주·캡션처럼 문단 안에 다시 문단이 들어가는 중첩의 한도.
 * 비정상 파일이 개체를 끝없이 겹쳐 스택을 소진하지 못하게 막는다.
 */
export const MAX_OBJECT_DEPTH = 8;

/** 문단을 어디에 그리는지 */
export interface WalkMode extends InlinePlacement {
  /** 그림을 글자 흐름 안에 둘지(표 셀·각주) 별도 블록으로 뺄지(본문) */
  readonly imagesInline: boolean;
  /** 개체 중첩 깊이 (MAX_OBJECT_DEPTH까지) */
  readonly depth: number;
}

export const BODY_MODE: WalkMode = {
  inCell: false,
  inHeading: false,
  imagesInline: false,
  depth: 0,
};

/**
 * 문서 전체에 걸친 진행 상태.
 *
 * 변경 추적 삭제 구간은 run·문단 경계를 넘어 이어지므로 문서 수준에서 센다.
 * 다만 구역(섹션) 경계는 넘지 않는다 — 짝이 안 맞는 비정상 파일에서 이후
 * 본문 전체가 사라지는 것을 막는다.
 */
export class DocumentState {
  deletedRanges = 0;
  equationFallbacks = 0;
  private deleteDepth = 0;

  get isDeleting(): boolean {
    return this.deleteDepth > 0;
  }

  beginDelete(): void {
    if (this.deleteDepth === 0) this.deletedRanges += 1;
    this.deleteDepth += 1;
  }

  endDelete(): void {
    this.deleteDepth = Math.max(0, this.deleteDepth - 1);
  }

  /** 새 구역 시작 — 열린 삭제 구간을 닫는다 */
  startSection(): void {
    this.deleteDepth = 0;
  }
}

/** 문단 렌더링 전반이 공유하는 읽기 전용 정의 + 진행 상태 */
export interface HwpxContext {
  readonly header: HwpxHeader;
  readonly images: ImageCollector;
  readonly state: DocumentState;
  /**
   * 각주·미주 본문을 한 줄 인라인 HTML로 그린다. 표 셀과 같은 규칙(문단을
   * 공백·" / "로 잇기)을 쓰는데, 그 구현이 문단 walker를 쓰므로 순환 import를
   * 피하려고 주입받는다.
   */
  readonly renderNote: (
    paragraphs: ReadonlyArray<XmlNode>,
    mode: WalkMode,
  ) => string;
}
