import { describe, expect, it } from "vitest";
import { balanceLeftRight } from "../src/parsers/hwp-equation/left-right.js";
import { lex } from "../src/parsers/hwp-equation/lexer.js";
import { mapTokens } from "../src/parsers/hwp-equation/map-tokens.js";
import { findNumerator } from "../src/parsers/hwp-equation/numerator.js";
import {
  balanceBraces,
  type EqToken,
} from "../src/parsers/hwp-equation/tokens.js";

/**
 * 분자 탐색의 방어선. 감싸는 그룹은 levels.ts 가 잡으므로 공개 API 로는
 * 닿지 않는 자리라, 수준이 어긋난 상황을 직접 만들어 확인한다 — 예전에는
 * 분모 안 over 가 바깥 수준을 이어 써 `\left(` 그룹을 단위로 나눴고, 그 안으로
 * 들어갈 때 구분자 `(` 에 멈춰 `\left.\frac{(b}{c} \right)` 가 됐다.
 */

/** 분수 재작성 직전의 토큰 (index.ts 의 패스 순서 중 이 입력에 쓰이는 것) */
function tokensBeforeFractions(script: string): ReadonlyArray<EqToken> {
  return balanceLeftRight(balanceBraces(mapTokens(lex(script))));
}

describe("findNumerator — 수준이 어긋나도 \\left 의 구분자는 분자가 아니다", () => {
  it.each([
    ["LEFT(", "LEFT(b over c RIGHT)"],
    ["LEFT[", "LEFT[b over c RIGHT]"],
    ["붙여 쓴 원자", "LEFT(2b over c RIGHT)"],
  ])("%s 그룹 밖에서 나누기 시작해도 구분자 뒤의 항이 분자다", (_t, script) => {
    // Arrange: over 를 감싸는 `\left` 그룹 대신 스크립트 전체(0)를 수준으로 준다
    const tokens = tokensBeforeFractions(script);
    const keyword = tokens.findIndex((token) => token.value === "over");
    const left = tokens.findIndex((token) => token.value === "\\left");

    // Act
    const walk = findNumerator(tokens, keyword, 0, null);

    // Assert: 구분자(left + 1) 뒤에서 시작한다
    expect(keyword).toBeGreaterThan(left + 2);
    expect(walk.start).toBe(left + 2);
  });
});
