import type { HwpxHeader } from "./header.js";
import type { ImageCollector } from "./images.js";
import type { InlinePlacement } from "./inline-builder.js";
import { MAX_MERGED_CELLS } from "./limits.js";
import { OrderedListTracker } from "./marker.js";
import type { NumberingTracker } from "./numbering.js";
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
 * 문서 전체 병합 칸 예산 (`MAX_MERGED_CELLS`). 병합 칸은 빈 칸으로 펼쳐져 작은
 * 입력이 수백만 칸으로 불어날 수 있어 표마다가 아니라 문서 단위로 센다.
 */
export class TableCellBudget {
  private used = 0;
  private truncated = 0;

  /** 아직 쓸 수 있는 병합 칸 수 */
  get remaining(): number {
    return Math.max(0, MAX_MERGED_CELLS - this.used);
  }

  /** 상한 때문에 일부만 낸 표 수 */
  get truncatedTables(): number {
    return this.truncated;
  }

  spend(cells: number): void {
    this.used += cells;
  }

  markTruncated(): void {
    this.truncated += 1;
  }
}

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
  outlineNumberingId = "1";
  readonly tableCells = new TableCellBudget();
  /** 본문에 날것으로 낸 번호 목록 — 구역이 바뀌어도 Markdown 에서는 이어진다 */
  readonly orderedList = new OrderedListTracker();
  private deleteDepth = 0;
  private readonly autoNumbers = new Map<string, number>();
  private readonly skippedObjects = new Map<string, number>();

  /** 내용을 옮기지 못하고 뺀 내장 개체 수 (종류 → 개수) */
  get skippedObjectCounts(): ReadonlyMap<string, number> {
    return this.skippedObjects;
  }

  /** 내용을 옮기지 못한 내장 개체(OLE·차트·동영상)를 하나 센다 */
  skipObject(kind: string): void {
    this.skippedObjects.set(kind, (this.skippedObjects.get(kind) ?? 0) + 1);
  }

  get isDeleting(): boolean {
    return this.deleteDepth > 0;
  }

  /**
   * 나중에 그리는 블록(표·글상자·캡션)을 삭제 구간 밖으로 그린다.
   *
   * 문단은 먼저 끝까지 훑은 뒤 표 같은 블록을 그린다. 그 사이 문단 뒤쪽에서
   * 삭제가 시작되면, 삭제 구간 앞에 놓였던 표까지 지워진 것처럼 그려졌다.
   * 블록은 삭제 구간이 아닐 때만 모이므로 그릴 때는 삭제 상태를 비운다.
   */
  withoutDeletion<T>(render: () => T): T {
    const saved = this.deleteDepth;
    this.deleteDepth = 0;
    try {
      return render();
    } finally {
      this.deleteDepth = saved;
    }
  }

  /** 캡션 자동 번호 — 저장된 번호(num)가 없으면 종류별로 이어 센다 */
  nextAutoNumber(type: string, stored: number | null): number {
    const value = stored ?? (this.autoNumbers.get(type) ?? 0) + 1;
    this.autoNumbers.set(type, value);
    return value;
  }

  beginDelete(): void {
    if (this.deleteDepth === 0) this.deletedRanges += 1;
    this.deleteDepth += 1;
  }

  endDelete(): void {
    this.deleteDepth = Math.max(0, this.deleteDepth - 1);
  }

  /** 새 구역 시작 — 삭제 구간을 닫고 개요 번호 체계를 바꾼다 */
  startSection(outlineNumberingId: string): void {
    this.deleteDepth = 0;
    this.outlineNumberingId = outlineNumberingId || "1";
  }
}

/** 문단 렌더링 전반이 공유하는 읽기 전용 정의 + 진행 상태 */
export interface HwpxContext {
  readonly header: HwpxHeader;
  readonly images: ImageCollector;
  readonly numbering: NumberingTracker;
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
