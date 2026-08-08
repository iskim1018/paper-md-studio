import { HANCOM_P15_SYMBOL_MAP } from "./pua-symbols-p15.js";

/**
 * HWP/HWPX가 사설영역(PUA, U+F0xx)에 저장하는 심볼 폰트 문자를
 * 표준 유니코드로 정규화한다.
 *
 * 한글(HWP)은 문자표의 기호를 Wingdings/Symbol 폰트 코드에 0xF000을 더한
 * PUA 코드포인트로 저장한다 (예: 체크박스 ■/□). 이 문자는 일반 폰트에서
 * 렌더링되지 않아 변환 결과에서 보이지 않게 되므로 매핑한다. 매핑에 없는
 * PUA 문자는 원본 그대로 둔다.
 *
 * 키를 코드포인트(0xF0xx)로 두는 이유: 문자 리터럴을 키로 쓰면 에디터에서
 * 보이지 않아 편집 사고가 나기 쉽다.
 */
const PUA_SYMBOL_MAP: Readonly<Record<number, string>> = {
  // ── 자체 매핑 (2026-07-23) ──
  61548: "●", // Wingdings 0x6C: black circle
  61549: "○", // Wingdings 0x6D: white circle
  61550: "■", // Wingdings 0x6E: black square (체크됨)
  61551: "□", // Wingdings 0x6F: white square
  61607: "▪", // Wingdings 0xA7: small black square (bullet)
  61608: "□", // Wingdings 0xA8: open square (미체크)
  61623: "•", // Symbol 0xB7: bullet
  61656: "➢", // Wingdings 0xD8: arrowhead (bullet)
  61691: "✗", // Wingdings 0xFB: ballot x
  61692: "✓", // Wingdings 0xFC: check mark
  61693: "☒", // Wingdings 0xFD: ballot box with x
  61694: "☑", // Wingdings 0xFE: ballot box with check

  // ── kordoc 실측으로 합친 것 (2026-08-08) ──
  // kordoc은 48개를 매핑하고 우리는 12개였다. 겹치는 코드는 위의 자체
  // 매핑을 유지한다 — kordoc은 0xF06D를 ●로 두지만 Wingdings 0x6D는
  // white circle이라 우리 쪽이 맞다. 아래는 우리에게 없던 코드만이다.
  61474: "✂",
  61494: "⌛",
  61509: "☜",
  61510: "☞",
  61511: "☝",
  61512: "☟",
  61514: "☺",
  61518: "☠",
  61522: "☼",
  61524: "❄",
  61528: "✠",
  61529: "✡",
  61552: "□",
  61553: "□",
  61554: "□",
  61555: "◇",
  61556: "◆",
  61557: "◆",
  61558: "❖",
  61559: "◆",
  61598: "·",
  61599: "•",
  61600: "·",
  61601: "○",
  61602: "○",
  61603: "○",
  61604: "◉",
  61605: "◎",
  61610: "✦",
  61611: "★",
  61612: "✶",
  61613: "✴",
  61614: "✹",
  61672: "➔",
  61679: "⇦",
  61680: "⇨",
  61681: "⇧",
  61682: "⇩",
};

/** 한컴 심볼이 쓰는 PUA 기본 평면 대역 (U+F000~U+F0FF) */
const PUA_BMP_PATTERN = /[\u{F000}-\u{F0FF}]/gu;

/** 한컴 보조 평면 PUA-A 대역 (Plane 15) */
const P15_PUA_PATTERN = /[\u{F0000}-\u{FFFFD}]/gu;

/**
 * 엔진마다 같은 기호에 다른 글자를 고르는 것을 우리 기준으로 통일한다.
 *
 * kordoc은 자체 PUA 정규화를 끝낸 상태로 Markdown을 내주기 때문에 원래
 * 코드포인트를 되살릴 수 없다. 글자 대 글자로 맞추는 수밖에 없다.
 * 같은 체크박스가 입력 경로(.hwp vs .hwpx)에 따라 달라 보이면 안 된다.
 */
const GLYPH_CANONICAL_MAP: Readonly<Record<string, string>> = {
  "◻": "□", // U+25FB WHITE MEDIUM SQUARE → U+25A1
  "❑": "□", // U+2751 → U+25A1
  "✔": "✓", // U+2714 HEAVY CHECK MARK → U+2713
  "✘": "✗", // U+2718 HEAVY BALLOT X → U+2717
  "⚪": "○", // U+26AA → U+25CB
  "⚫": "●", // U+26AB → U+25CF
  "⬧": "◇", // U+2B27 → U+25C7
  "⬥": "◆", // U+2B25 → U+25C6
  "⧫": "◆", // U+29EB → U+25C6
};

const GLYPH_CANONICAL_PATTERN = new RegExp(
  `[${Object.keys(GLYPH_CANONICAL_MAP).join("")}]`,
  "g",
);

/** 텍스트 내 알려진 PUA 심볼 문자를 표준 유니코드로 치환한다 */
export function normalizePuaSymbols(text: string): string {
  return text
    .replace(PUA_BMP_PATTERN, (ch) => {
      const codePoint = ch.codePointAt(0);
      if (codePoint === undefined) return ch;
      return PUA_SYMBOL_MAP[codePoint] ?? ch;
    })
    .replace(P15_PUA_PATTERN, (ch) => {
      const codePoint = ch.codePointAt(0);
      if (codePoint === undefined) return ch;
      return HANCOM_P15_SYMBOL_MAP[codePoint] ?? ch;
    });
}

/**
 * 다른 엔진이 고른 동의(同義) 글리프를 우리 기준으로 통일한다.
 * PUA 정규화를 이미 끝낸 산출물(kordoc 출력)에 쓴다.
 */
export function canonicalizeGlyphs(text: string): string {
  return text.replace(
    GLYPH_CANONICAL_PATTERN,
    (ch) => GLYPH_CANONICAL_MAP[ch] ?? ch,
  );
}
