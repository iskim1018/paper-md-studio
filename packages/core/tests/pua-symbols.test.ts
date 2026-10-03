import { describe, expect, it } from "vitest";
import {
  canonicalizeGlyphs,
  normalizePuaSymbols,
} from "../src/parsers/pua-symbols.js";

describe("normalizePuaSymbols", () => {
  it("체크박스 PUA 문자를 ■/□로 치환한다", () => {
    // Arrange: 한컴 조사서 양식의 체크 항목 패턴 (U+F06E 채움, U+F0A8 빈칸)
    const text = " 필요   불필요  기타(  )";

    // Act
    const result = normalizePuaSymbols(text);

    // Assert
    expect(result).toBe("□ 필요  ■ 불필요 □ 기타(  )");
  });

  it("Wingdings 계열 심볼을 유니코드로 치환한다", () => {
    expect(normalizePuaSymbols("")).toBe("●○□");
    expect(normalizePuaSymbols(" 완료  실패")).toBe("✓ 완료 ✗ 실패");
    expect(normalizePuaSymbols(" 동의  미동의")).toBe("☑ 동의 ☒ 미동의");
    expect(normalizePuaSymbols(" 목록  항목")).toBe("• 목록 ▪ 항목");
  });

  it("매핑에 없는 PUA 문자는 원본을 유지한다", () => {
    expect(normalizePuaSymbols(" 텍스트")).toBe(" 텍스트");
  });

  it("일반 텍스트는 변경하지 않는다", () => {
    const text = "일반 한글 텍스트와 기호 ■ □ ● 유지";

    expect(normalizePuaSymbols(text)).toBe(text);
  });

  it("kordoc 실측으로 합친 코드도 치환한다 (2026-08-08 합집합)", () => {
    // kordoc이 매핑하고 우리는 빠뜨렸던 대역. 코드포인트 이스케이프로 쓰는
    // 이유는 PUA 문자가 편집기에서 보이지 않아 리터럴로 두면 사고가 나서다.
    expect(normalizePuaSymbols("\u{F0AB}")).toBe("★");
    expect(normalizePuaSymbols("\u{F04A}")).toBe("☺");
    expect(normalizePuaSymbols("\u{F0F0}")).toBe("⇨");
    expect(normalizePuaSymbols("\u{F0A4}")).toBe("◉");
  });

  it("겹치는 코드는 자체 매핑을 유지한다 — kordoc의 0xF06D는 틀렸다", () => {
    // Wingdings 0x6D는 white circle이다. kordoc은 ●로 두지만 우리가 맞다.
    expect(normalizePuaSymbols("\u{F06D}")).toBe("○");
    expect(normalizePuaSymbols("\u{F0A8}")).toBe("□");
    expect(normalizePuaSymbols("\u{F0FC}")).toBe("✓");
  });
});

describe("canonicalizeGlyphs", () => {
  it("다른 엔진이 고른 동의 글리프를 우리 기준으로 통일한다", () => {
    // kordoc은 PUA 정규화를 끝낸 상태로 주므로 코드포인트를 되살릴 수 없다.
    // 글자 대 글자로 맞추는 수밖에 없다.
    expect(canonicalizeGlyphs("◻ 미체크")).toBe("□ 미체크");
    expect(canonicalizeGlyphs("✔ 완료")).toBe("✓ 완료");
    expect(canonicalizeGlyphs("⚪⚫")).toBe("○●");
  });

  it("이미 우리 기준인 글자는 그대로 둔다", () => {
    const text = "□ 미체크 ✓ 완료 ○ ● ■";

    expect(canonicalizeGlyphs(text)).toBe(text);
  });

  it("일반 텍스트는 건드리지 않는다", () => {
    const text = "제안서 검토 결과는 다음과 같습니다.";

    expect(canonicalizeGlyphs(text)).toBe(text);
  });
});

describe("한컴 보조 평면(P15) 심볼", () => {
  it("U+F02FC 등 삼각형 불릿을 표준 유니코드로 치환한다", () => {
    expect(normalizePuaSymbols("\u{F02FC} 항목")).toBe("▶ 항목");
    expect(normalizePuaSymbols("\u{F02F8}\u{F02FE}\u{F02FF}")).toBe("◀▲▼");
  });

  it("괄호 조각·음표 등 자동 매핑 항목을 치환한다", () => {
    expect(normalizePuaSymbols("\u{F000E}")).toBe("⎡");
    expect(normalizePuaSymbols("\u{F0055}")).toBe("♬");
  });

  it("매핑에 없는 P15 문자는 원본을 유지한다", () => {
    expect(normalizePuaSymbols("\u{F1234} 유지")).toBe("\u{F1234} 유지");
  });

  it("네모 숫자(U+F02B0~U+F02B9)를 원문자 ⓪~⑨로 치환한다", () => {
    // 함초롬바탕에서 이 구간은 네모 안 숫자 0~9다. 유니코드에 네모 숫자가
    // 없어 같은 "둘러싼 숫자"인 원문자로 옮긴다 (kordoc과 같은 선택).
    expect(normalizePuaSymbols("\u{F02B1} 항목")).toBe("① 항목");
    expect(
      normalizePuaSymbols(
        "\u{F02B0}\u{F02B2}\u{F02B3}\u{F02B4}\u{F02B5}\u{F02B6}\u{F02B7}\u{F02B8}\u{F02B9}",
      ),
    ).toBe("⓪②③④⑤⑥⑦⑧⑨");
  });

  it("두 번째 네모 숫자 묶음(U+F02BA~U+F02C2)도 ①~⑨로 치환한다", () => {
    // kordoc은 U+F02BA부터 ⑩·⑪…로 이어 붙였지만, 글리프는 다시 1~9다.
    expect(normalizePuaSymbols("\u{F02BA}\u{F02C2}")).toBe("①⑨");
  });

  it("네모 숫자 다음 구간(U+F02C3~, 장식 없는 숫자)은 건드리지 않는다", () => {
    expect(normalizePuaSymbols("\u{F02C3}")).toBe("\u{F02C3}");
  });
});
