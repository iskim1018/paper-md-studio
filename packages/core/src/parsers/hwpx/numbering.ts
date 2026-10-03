import { canonicalizeGlyphs, normalizePuaSymbols } from "../pua-symbols.js";
import type { HwpxHeader, NumberingDef } from "./header.js";

/**
 * 문단 머리(글머리표·문단 번호·개요 번호) 해석.
 *
 * 한글은 "1.", "가.", "•" 같은 머리를 본문 글자로 저장하지 않는다. 문단
 * 모양(paraPr > heading)이 header.xml의 bullets/numberings 정의를 가리키고,
 * 번호는 화면에 그릴 때 수준별 카운터로 계산한다. 정의를 읽지 않으면 머리가
 * 통째로 사라진다 (실물 4건 중 3건에서 수백 문단).
 */

const HANGUL_INITIALS = [0, 2, 3, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18];
/** 가→하 다음은 거→허, 고→호 … (단모음 순) */
const HANGUL_MEDIALS = [0, 4, 8, 13, 18, 20];
const HANGUL_JAMO = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
const HANGUL_BASE = 0xac00;
const CYCLE = 14;
const MAX_ROMAN = 3999;
const MAX_LEVEL = 10;
/** 빈 자리(아직 안 쓴 수준) 표시 — 0은 start="0"의 유효한 값이라 쓸 수 없다 */
const UNUSED = -1;

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function hangulSyllable(n: number): string {
  const index = n - 1;
  const medial =
    HANGUL_MEDIALS[
      Math.min(Math.floor(index / CYCLE), HANGUL_MEDIALS.length - 1)
    ] ?? 0;
  const initial = HANGUL_INITIALS[index % CYCLE] ?? 0;
  return String.fromCodePoint(HANGUL_BASE + initial * 588 + medial * 28);
}

function hangulJamo(n: number): string {
  return HANGUL_JAMO[(n - 1) % CYCLE] ?? String(n);
}

function circledDigit(n: number): string {
  if (n <= 20) return String.fromCodePoint(0x2460 + n - 1); // ①~⑳
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21); // ㉑~㉟
  if (n <= 50) return String.fromCodePoint(0x32b1 + n - 36); // ㊱~㊿
  return `(${n})`;
}

/** 1→A, 26→Z, 27→AA (엑셀 열 이름과 같은 26진) */
function latin(n: number, upper: boolean): string {
  let rest = n;
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode((upper ? 65 : 97) + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function roman(n: number, upper: boolean): string {
  if (n > MAX_ROMAN) return String(n);
  let rest = n;
  let out = "";
  for (const [value, symbol] of ROMAN_TABLE) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return upper ? out : out.toLowerCase();
}

type Formatter = (n: number) => string;

/** OWPML NumberType1 이름 → 서식. LATIN_UPPER 등은 구버전 표기 별칭 */
const FORMATTERS: Readonly<Record<string, Formatter>> = {
  HANGUL_SYLLABLE: hangulSyllable,
  CIRCLED_HANGUL_SYLLABLE: (n) =>
    n <= CYCLE ? String.fromCodePoint(0x326e + n - 1) : hangulSyllable(n),
  HANGUL_JAMO: hangulJamo,
  CIRCLED_HANGUL_JAMO: (n) =>
    n <= CYCLE ? String.fromCodePoint(0x3260 + n - 1) : hangulJamo(n),
  CIRCLED_DIGIT: circledDigit,
  LATIN_CAPITAL: (n) => latin(n, true),
  LATIN_UPPER: (n) => latin(n, true),
  LATIN_SMALL: (n) => latin(n, false),
  LATIN_LOWER: (n) => latin(n, false),
  CIRCLED_LATIN_CAPITAL: (n) =>
    n <= 26 ? String.fromCodePoint(0x24b6 + n - 1) : latin(n, true),
  CIRCLED_LATIN_SMALL: (n) =>
    n <= 26 ? String.fromCodePoint(0x24d0 + n - 1) : latin(n, false),
  ROMAN_CAPITAL: (n) => roman(n, true),
  ROMAN_UPPER: (n) => roman(n, true),
  ROMAN_SMALL: (n) => roman(n, false),
  ROMAN_LOWER: (n) => roman(n, false),
};

/**
 * 번호 값을 문단 번호 서식(numFormat)으로 쓴다. 모르는 서식과 1 미만 값은
 * 아라비아 숫자로 쓴다 (start="0"이면 0이 실제로 화면에 나온다).
 */
export function formatHeadNumber(n: number, numFormat: string): string {
  const formatter = FORMATTERS[numFormat];
  if (!formatter || n < 1) return String(n);
  return formatter(n);
}

/** 문단 머리 기호 — kind는 렌더링 차이(목록 항목에는 글머리표를 겹치지 않음)에 쓴다 */
export interface ParagraphMarker {
  readonly kind: "bullet" | "number";
  readonly text: string;
}

const SOFT_HYPHEN = "\u{AD}";
const PUA_PATTERN = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}]/u;

function bulletMarker(rawChar: string): ParagraphMarker | null {
  if (!rawChar) return null;
  // 한컴 "- 본문" 글머리표가 소프트 하이픈으로 저장된 경우 (실물 표본 35곳)
  if (rawChar === SOFT_HYPHEN) return { kind: "bullet", text: "-" };
  const text = canonicalizeGlyphs(normalizePuaSymbols(rawChar)).trim();
  if (!text) return null;
  // 매핑에 없는 PUA는 일반 글꼴에서 보이지 않는다 — 점으로 대신한다
  return { kind: "bullet", text: PUA_PATTERN.test(text) ? "•" : text };
}

/**
 * 번호 문단 카운터.
 *
 * 번호 체계(numbering id)마다 수준별 카운터를 둔다. 한 수준이 늘면 그보다
 * 깊은 수준은 다시 처음(start)부터 센다. 본문·표 셀·글상자가 같은 카운터를
 * 공유한다 — 한글 화면에서 셀 안 번호도 문서 전체 흐름으로 이어진다.
 */
export class NumberingTracker {
  private readonly counters = new Map<string, Array<number>>();
  private advanceCount = 0;
  /** 마지막 진행 직전의 카운터 — `undoLast`가 되돌린다 */
  private lastAdvance: {
    readonly numberingId: string;
    readonly before: ReadonlyArray<number>;
  } | null = null;

  /** 지금까지 진행한 횟수 — 문단 하나가 번호를 소비했는지 가리는 데 쓴다 */
  get advances(): number {
    return this.advanceCount;
  }

  /** 카운터를 한 칸 진행하고 형식 문자열을 채운 머리를 돌려준다 */
  next(numberingId: string, level: number, def: NumberingDef): string {
    const counters = this.countersOf(numberingId);
    this.lastAdvance = { numberingId, before: [...counters] };
    this.advanceCount += 1;
    const head = def.get(level);
    const current = counters[level] ?? UNUSED;
    counters[level] = current === UNUSED ? (head?.start ?? 1) : current + 1;
    for (let deeper = level + 1; deeper <= MAX_LEVEL; deeper += 1) {
      counters[deeper] = UNUSED;
    }
    // 정의 자체가 없는 수준만 "^N."으로 보충한다. 형식이 명시적으로 빈
    // 수준(한컴 "번호 없음")에는 번호를 지어내지 않는다.
    const format = head ? head.format : `^${level}.`;
    return format.replace(/\^(10|[1-9])/g, (_match, digits: string) => {
      const refLevel = Number(digits);
      const refHead = def.get(refLevel);
      const value = counters[refLevel] ?? UNUSED;
      const n = value === UNUSED ? (refHead?.start ?? 1) : value;
      return formatHeadNumber(n, refHead?.numFormat ?? "DIGIT");
    });
  }

  /**
   * 마지막 진행을 되돌린다 — 변경 추적으로 통째로 지운 문단은 최종본에 없으므로
   * 번호를 소비하지 않는다. 그 사이에 다른 진행이 없었을 때만 부른다.
   */
  undoLast(): void {
    const last = this.lastAdvance;
    if (!last) return;
    this.counters.set(last.numberingId, [...last.before]);
    this.lastAdvance = null;
    this.advanceCount -= 1;
  }

  private countersOf(numberingId: string): Array<number> {
    const existing = this.counters.get(numberingId);
    if (existing) return existing;
    const created = new Array<number>(MAX_LEVEL + 1).fill(UNUSED);
    this.counters.set(numberingId, created);
    return created;
  }
}

/**
 * 문단 모양 id로 문단 머리를 정한다. 번호 문단은 내용이 비어도 카운터를
 * 진행해야 하므로(한글은 빈 번호 문단에도 번호를 그린다) 문단마다 한 번씩
 * 반드시 부른다.
 *
 * @param outlineNumberingId 구역(secPr)의 outlineShapeIDRef — 개요 문단의 번호 체계
 */
export function resolveParagraphMarker(
  paraPrId: string,
  header: HwpxHeader,
  tracker: NumberingTracker,
  outlineNumberingId: string,
): ParagraphMarker | null {
  const ref = header.paraHeadings.get(paraPrId);
  if (!ref) return null;
  if (ref.type === "BULLET") {
    return bulletMarker(header.bullets.get(ref.idRef) ?? "");
  }
  const numberingId = ref.type === "OUTLINE" ? outlineNumberingId : ref.idRef;
  const def = header.numberings.get(numberingId);
  if (!def) return null;
  const text = tracker.next(
    numberingId,
    Math.min(ref.level + 1, MAX_LEVEL),
    def,
  );
  return text.trim() ? { kind: "number", text: text.trim() } : null;
}
