import { escapeHtml, protectCellPipes } from "./inline-builder.js";
import { leadingBlockSafeHtml, rawMarkdownHtml } from "./markdown.js";

/**
 * 문단 머리(번호·글머리표)를 Markdown 으로 내는 규칙.
 *
 * 한글의 문단 머리는 header.xml 정의로 그려지는 글자라 본문에 없다. 그중
 * CommonMark 목록 머리 모양(`1.`·`1)`·`-`·`+`·`*`)만 날것으로 내어 목록이 되게
 * 하고, 나머지(`가.`·`(1)`·`•`·`#`·`[^1](…)` 같은 문서 정의 글자)는 일반
 * 글자로 escape 한다 — 문서가 정한 글자가 제목·링크·표 구분자가 되지 않게.
 */

const ORDERED_MARKER = /^(\d{1,9})([.)])$/;
const BULLET_MARKER = /^[-+*]$/;

/** 머리가 놓이는 자리 — 줄 맨 앞(문단·목록 항목)만 블록 문법을 신경 쓴다 */
export type MarkerPlacement = "paragraph" | "heading" | "cell";

/** CommonMark 번호 목록 머리 */
export interface OrderedMarker {
  readonly value: number;
  readonly delimiter: "." | ")";
}

export function orderedMarker(marker: string): OrderedMarker | null {
  const match = ORDERED_MARKER.exec(marker);
  if (!match) return null;
  return {
    value: Number(match[1]),
    delimiter: match[2] === ")" ? ")" : ".",
  };
}

function isListMarker(marker: string): boolean {
  return ORDERED_MARKER.test(marker) || BULLET_MARKER.test(marker);
}

/**
 * 문단 머리를 내용 앞에 붙인다.
 *
 * - 목록 머리 모양은 날것으로 낸다. 문단에서는 뒤 글자를 `leadingBlockSafeHtml`
 *   로 감싸, `2024. 3. 1.`·`1) 하위`·`> 비고`가 목록 항목 안에서 다시 블록
 *   (중첩 목록·인용)이 되지 않게 한다 — 머리가 날것이면 turndown 의 줄 머리
 *   escape 가 그 뒤 글자에는 걸리지 않는다.
 * - `asText`: 번호를 글자로 낸다 (`3\.`). 렌더러가 번호를 다시 매기는 자리다.
 * - 그 밖의 머리는 일반 글자 — escape 되고, 표 셀에서는 "|"를 보호한다.
 */
export function withMarker(
  marker: string | null,
  html: string,
  placement: MarkerPlacement,
  asText = false,
): string {
  if (!marker) return html;
  if (!isListMarker(marker)) {
    const text = protectCellPipes(escapeHtml(marker), placement === "cell");
    return `${text} ${html}`;
  }
  if (placement !== "paragraph") return `${rawMarkdownHtml(marker)} ${html}`;
  if (asText) return leadingBlockSafeHtml(`${escapeHtml(marker)} ${html}`);
  return `${rawMarkdownHtml(marker)} ${leadingBlockSafeHtml(html)}`;
}

/**
 * 번호 목록의 번호 보존.
 *
 * CommonMark 렌더러는 이어 붙은 번호 항목을 한 목록으로 묶고 첫 항목 번호부터
 * 차례로 다시 센다 — 빈 번호 문단이 번호를 소비한 `1. a` / `3. c`는 1, 2로,
 * 번호 체계가 다시 시작한 `1. 2. 1.`은 1, 2, 3으로 보인다. 직전에 날것으로 낸
 * 항목을 기억해, 렌더러가 다른 번호를 그릴 항목은 번호를 글자로 낸다.
 */
export class OrderedListTracker {
  private last: OrderedMarker | null = null;

  /** 이 번호를 날것으로 내도 렌더러에서 같은 번호로 보이는지 */
  rendersAsIs(marker: OrderedMarker): boolean {
    const last = this.last;
    // 새 목록의 첫 항목은 시작 번호(start)를 그대로 쓴다. 구분자가 바뀌어도 새 목록이다
    if (!last || last.delimiter !== marker.delimiter) return true;
    return marker.value === last.value + 1;
  }

  /** 방금 쓴 블록 — 날것 번호 항목이면 그 번호, 아니면(목록이 끊김) null */
  wrote(marker: OrderedMarker | null): void {
    this.last = marker;
  }
}
