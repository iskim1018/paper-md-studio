import { PIPE_TOKEN } from "../html-tables-to-gfm.js";
import { canonicalizeGlyphs, normalizePuaSymbols } from "../pua-symbols.js";
import type { InlineToken } from "./inline-tokens.js";

/** run 하나의 강조 상태 */
export interface RunStyle {
  readonly strong: boolean;
  readonly em: boolean;
  readonly del: boolean;
}

export const PLAIN_STYLE: RunStyle = { strong: false, em: false, del: false };

/** 인라인 내용이 놓이는 자리 — 같은 토큰도 자리마다 다르게 그린다 */
export interface InlinePlacement {
  /** 표 셀 안 — "|"를 자리표시자로 바꿔 열 구분자와 겹치지 않게 한다 */
  readonly inCell: boolean;
  /** 제목 안 — 줄바꿈을 공백으로 (`# 가  \n나`는 제목이 끊긴다) */
  readonly inHeading: boolean;
}

/**
 * 채움선 탭(목차의 "제1장 ······ 3")을 대신하는 구분자. PDF 목차 보정과 같은
 * 문자열이라 두 경로의 목차 모양이 같다 (`pdf-postprocess.ts` TOC_SEPARATOR).
 */
const LEADER_TAB = " — ";
/** 일반 탭 — turndown이 공백 하나로 접는다 */
const PLAIN_TAB = "\t";
/** rhwp가 HWP3 개체 자리에 남기는 개체 대체 문자 — 보이지 않는 쓰레기다 */
const OBJECT_REPLACEMENT = /\u{FFFC}/gu;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 속성값용 — 따옴표까지 escape한다 */
export function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** 표 셀 안이면 "|"를 자리표시자로 바꾼다 — turndown 뒤 `restorePipes`가 "\\|"로 되돌린다 */
export function protectCellPipes(html: string, inCell: boolean): string {
  return inCell ? html.replace(/\|/g, PIPE_TOKEN) : html;
}

/** 본문 글자 정규화 — PUA 기호 치환, 글리프 통일, 개체 대체 문자 제거 */
export function normalizeText(text: string): string {
  return canonicalizeGlyphs(normalizePuaSymbols(text)).replace(
    OBJECT_REPLACEMENT,
    "",
  );
}

/** 열린 하이퍼링크 — 태그 시작·글자 시작 위치와, 삭제 구간이 글자를 지웠는지 */
interface OpenLink {
  readonly tagStart: number;
  readonly start: number;
  readonly url: string;
  readonly deletedContent: boolean;
}

/**
 * 문단 하나 분량의 인라인 HTML을 쌓는다.
 *
 * 강조가 같은 run이 이어지면 태그 하나로 묶고(`**볼드1볼드2**`), 바뀌면 모든
 * 태그를 닫고 다시 연다 — 바깥부터 strong → em → del 순서를 고정해 turndown이
 * 겹친 강조를 안정적으로 내린다. 링크·그림·수식처럼 통째로 끼우는 조각 앞에서는
 * 강조를 닫아 HTML이 엇갈리지 않게 한다.
 */
export class InlineBuilder {
  private html = "";
  private open: RunStyle = PLAIN_STYLE;
  private visible = false;
  private link: OpenLink | null = null;

  constructor(private readonly placement: InlinePlacement) {}

  /** 보이는 내용(공백이 아닌 글자·그림·수식)이 있는지 */
  get hasContent(): boolean {
    return this.visible;
  }

  /** `<hp:t>` 토큰 하나를 강조 상태와 함께 쌓는다 */
  token(token: InlineToken, style: RunStyle): void {
    switch (token.kind) {
      case "text":
        this.text(normalizeText(token.value), style);
        return;
      case "tab":
        this.text(token.leader ? LEADER_TAB : PLAIN_TAB, style);
        return;
      case "space":
        this.text(" ", style);
        return;
      case "lineBreak":
        if (this.placement.inHeading) this.text(" ", style);
        else this.html += "<br>";
        return;
      default:
        return;
    }
  }

  /** 글자를 escape해서 쌓는다 */
  text(value: string, style: RunStyle): void {
    if (!value) return;
    this.switchStyle(style);
    this.html += this.escape(value);
    if (/\S/.test(value)) this.visible = true;
  }

  /** 이미 HTML인 조각(그림·수식·각주)을 강조 밖에 끼운다 */
  raw(html: string): void {
    if (!html) return;
    this.switchStyle(PLAIN_STYLE);
    this.html += html;
    this.visible = true;
  }

  /** 하이퍼링크를 연다 — url은 호출측이 검증한 안전한 주소여야 한다 */
  openLink(url: string): void {
    this.closeLink();
    this.switchStyle(PLAIN_STYLE);
    const tagStart = this.html.length;
    this.html += `<a href="${escapeAttribute(url)}">`;
    this.link = {
      tagStart,
      start: this.html.length,
      url,
      deletedContent: false,
    };
  }

  /**
   * 변경 추적 삭제 구간이 내용을 지웠다고 알린다. 링크 글자가 전부 지워졌으면
   * 빈 링크 대신 아무것도 내지 않아야 한다 — 주소를 글자로 보이면 지운 링크의
   * 주소가 새로 생겨난다.
   */
  markDeleted(): void {
    if (this.link && !this.link.deletedContent) {
      this.link = { ...this.link, deletedContent: true };
    }
  }

  closeLink(): void {
    const link = this.link;
    if (!link) return;
    this.link = null;
    this.switchStyle(PLAIN_STYLE);
    if (this.html.length === link.start) {
      if (link.deletedContent) {
        this.html = this.html.slice(0, link.tagStart);
        return;
      }
      // 글자 없는 링크는 `[](url)`이 되므로 주소를 글자로 보인다
      this.html += escapeHtml(link.url);
      this.visible = true;
    }
    this.html += "</a>";
  }

  /** 열린 태그를 모두 닫고 결과를 돌려준다 */
  finish(): string {
    this.closeLink();
    this.switchStyle(PLAIN_STYLE);
    return this.html;
  }

  private escape(value: string): string {
    return protectCellPipes(escapeHtml(value), this.placement.inCell);
  }

  private switchStyle(next: RunStyle): void {
    const cur = this.open;
    if (
      cur.strong === next.strong &&
      cur.em === next.em &&
      cur.del === next.del
    ) {
      return;
    }
    if (cur.del) this.html += "</del>";
    if (cur.em) this.html += "</em>";
    if (cur.strong) this.html += "</strong>";
    if (next.strong) this.html += "<strong>";
    if (next.em) this.html += "<em>";
    if (next.del) this.html += "<del>";
    this.open = next;
  }
}
