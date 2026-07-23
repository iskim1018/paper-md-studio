import { describe, expect, it } from "vitest";
import { normalizePuaSymbols } from "../src/parsers/pua-symbols.js";

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
});
