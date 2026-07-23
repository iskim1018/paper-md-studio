import { HANCOM_P15_SYMBOL_MAP } from "./pua-symbols-p15.js";

/**
 * HWP/HWPX가 사설영역(PUA, U+F0xx)에 저장하는 심볼 폰트 문자를
 * 표준 유니코드로 정규화한다.
 *
 * 한글(HWP)은 문자표의 기호를 Wingdings/Symbol 폰트 코드에 0xF000을
 * 더한 PUA 코드포인트로 저장하는 경우가 있다 (예: 체크박스 ■/□).
 * 이 문자는 일반 폰트에서 렌더링되지 않아 변환 결과에서 보이지 않게
 * 되므로, 잘 알려진 코드만 보수적으로 매핑한다. 매핑에 없는 PUA
 * 문자는 원본 그대로 유지한다.
 */
const PUA_SYMBOL_MAP: Readonly<Record<string, string>> = {
  "": "●", // Wingdings 0x6C: black circle
  "": "○", // Wingdings 0x6D: white circle
  "": "■", // Wingdings 0x6E: black square (체크됨)
  "": "□", // Wingdings 0x6F: white square
  "": "▪", // Wingdings 0xA7: small black square (bullet)
  "": "□", // Wingdings 0xA8: open square (미체크)
  "": "•", // Symbol 0xB7: bullet
  "": "➢", // Wingdings 0xD8: arrowhead (bullet)
  "": "✗", // Wingdings 0xFB: ballot x
  "": "✓", // Wingdings 0xFC: check mark
  "": "☒", // Wingdings 0xFD: ballot box with x
  "": "☑", // Wingdings 0xFE: ballot box with check
};

const PUA_SYMBOL_PATTERN = new RegExp(
  `[${Object.keys(PUA_SYMBOL_MAP).join("")}]`,
  "g",
);

/** 한컴 보조 평면 PUA-A 대역 (Plane 15) */
const P15_PUA_PATTERN = /[\u{F0000}-\u{FFFFD}]/gu;

/** 텍스트 내 알려진 PUA 심볼 문자를 표준 유니코드로 치환한다 */
export function normalizePuaSymbols(text: string): string {
  return text
    .replace(PUA_SYMBOL_PATTERN, (ch) => PUA_SYMBOL_MAP[ch] ?? ch)
    .replace(P15_PUA_PATTERN, (ch) => {
      const codePoint = ch.codePointAt(0);
      if (codePoint === undefined) return ch;
      return HANCOM_P15_SYMBOL_MAP[codePoint] ?? ch;
    });
}
