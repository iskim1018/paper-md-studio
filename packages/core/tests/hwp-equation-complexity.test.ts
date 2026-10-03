import { describe, expect, it } from "vitest";
import { hwpEquationToLatex } from "../src/parsers/hwp-equation/index.js";
import { parseHwpx } from "./helpers/hwpx-fixture.js";

/**
 * 수식 변환의 작업량 상한.
 *
 * 변환은 REST·MCP 서버에서도 요청 스레드에서 동기로 돈다. 짝 없는 괄호를
 * 첨자로 겹겹이 쌓은 스크립트 하나가 O(n³) 경로를 타 수 분 동안 이벤트 루프를
 * 막았다 (`"x^(".repeat(3300)` 417초, 2026-10-03 실측). 이 파일의 입력은 그
 * 재현 패턴이다 — 결과는 변환이든 null(호출측이 원문 코드로 폴백)이든 좋지만,
 * 시간은 입력 길이에 거의 비례해야 한다.
 *
 * 예산 200ms 는 실측(수 ms)에 수십 배 여유를 둔 값이다. 고치기 전에는 같은
 * 입력이 13초~417초 걸렸으므로 부하로 흔들릴 일 없이 회귀만 잡는다.
 */
const TIME_BUDGET_MS = 200;

function timed(script: string): {
  readonly result: string | null;
  readonly elapsed: number;
} {
  const started = performance.now();
  const result = hwpEquationToLatex(script);
  return { result, elapsed: performance.now() - started };
}

function equation(script: string): string {
  return `<equation id="1" version="Equation Version 60"><script>${script}</script></equation>`;
}

/** 표 셀·인라인 `$…$` 에 그대로 넣을 수 있는 출력인가 (null 은 폴백이라 허용) */
function expectEmbeddableOrNull(result: string | null): void {
  if (result === null) return;
  expect(result).not.toMatch(/[\r\n|$`]/);
  expect(result).toBe(result.trim());
}

describe("hwpEquationToLatex — 적대적 입력의 작업량", () => {
  it.each([
    ["짝 없는 ( 를 위첨자로 쌓기 (9,900자)", "x^(".repeat(3300)],
    ["짝 없는 [ 를 위첨자로 쌓기", "x^[".repeat(800)],
    ["괄호 뒤 위첨자 괄호", "(^(".repeat(800)],
    [
      "띄운 여는 괄호 뒤 연속 over",
      `${"( ".repeat(800)}${"a over ".repeat(400)}b`,
    ],
    ["짝 없는 ( 를 아래첨자로 쌓기", "x_(".repeat(3300)],
    ["부호 붙은 첨자 괄호", "x^-(".repeat(2400)],
    ["닫힌 괄호를 위첨자로 잇기", "(x)^".repeat(2400)],
    [
      "짝 없는 대괄호 뒤 연속 over",
      `${"[ ".repeat(1500)}${"a over ".repeat(900)}`,
    ],
    ["괄호 없는 근호 겹치기", "sqrt ".repeat(1900)],
    ["root 겹치기", "root ".repeat(1900)],
    ["여는 중괄호만", "{".repeat(10_000)],
    ["연속 atop", "a atop ".repeat(1400)],
  ])("%s 도 200ms 안에 끝난다", (_title, script) => {
    // Act
    const { result, elapsed } = timed(script);

    // Assert
    expect(script.length).toBeLessThanOrEqual(10_000);
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
    expectEmbeddableOrNull(result);
  });

  it("중첩이 지나치게 깊으면 변환하지 않고 null — 호출측이 원문 코드로 폴백한다", () => {
    // Arrange: 실물 수식의 중첩은 깊어야 수십 단계다
    const script = `${"{".repeat(500)}x${"}".repeat(500)}`;

    // Act & Assert
    expect(hwpEquationToLatex(script)).toBeNull();
  });

  it("실물 수준의 깊은 중첩(30단)은 그대로 변환한다", () => {
    // Arrange: 연분수 30단
    const script = `${"{1} over {1 + ".repeat(30)}x${"}".repeat(30)}`;

    // Act
    const result = hwpEquationToLatex(script);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.match(/\\frac/g)).toHaveLength(30);
  });

  it("HWPX 문서에 섞여 있어도 변환이 막히지 않고 그 수식만 원문 코드로 남긴다", async () => {
    // Arrange: 고치기 전에는 이런 수식 하나에 문서 변환이 32초 걸렸다
    const hostile = "x^[".repeat(800);
    const hostileRuns = Array.from(
      { length: 3 },
      () => `<run>${equation(hostile)}</run>`,
    ).join("");
    const section =
      `<sec><p styleIDRef="0">${hostileRuns}</p>` +
      `<p styleIDRef="0"><run>${equation("1 over 2")}</run></p></sec>`;

    // Act
    const started = performance.now();
    const result = await parseHwpx(section);
    const elapsed = performance.now() - started;

    // Assert: 문서 파싱 비용까지 넣어 넉넉히 1초
    expect(elapsed).toBeLessThan(1000);
    expect(result.markdown).toContain("$\\frac{1}{2}$");
    expect(result.markdown).toContain(`\`${hostile}\``);
    expect(result.warnings).toEqual([
      "수식 3개는 LaTeX로 바꾸지 못해 원본 수식 스크립트를 코드로 남겼습니다.",
    ]);
  });

  /**
   * 분모 안에 over 가 하나 더 있는 분수를 잇는다. 바깥 over 마다 분자를 찾으려
   * 스크립트 맨 앞까지 다시 훑어 작업량이 반복 수의 제곱으로 늘었고, 10,000자
   * 가까이에서 작업량 한도에 걸려 수식 전체가 원문 코드로 빠졌다 (null).
   */
  it.each([
    ["중괄호 분모", "a over {b + c over d} + ", "\\frac{a}{b + \\frac{c}{d}}"],
    [
      "소괄호 분모",
      "a over (b + c over d) + ",
      "\\frac{a}{(b + \\frac{c}{d})}",
    ],
  ])("분모 안 분수를 품은 분수 416개(%s)도 100ms 안에 끝까지 변환한다", (_title, unit, fraction) => {
    // Arrange
    const script = unit.repeat(416);

    // Act
    const { result, elapsed } = timed(script);

    // Assert
    expect(script.length).toBeLessThanOrEqual(10_000);
    const expected = Array.from({ length: 416 }, () => fraction).join(" + ");
    expect(result).toBe(`${expected} +`);
    expect(elapsed).toBeLessThan(100);
  });

  it("분수가 많은 긴 스크립트(약 10,000자)도 변환한다", () => {
    // Arrange: 서로 독립인 분수 700여 개 — 길지만 모양은 실물과 같다
    const script = "{a_1} over {b^2} + ".repeat(520);

    // Act
    const { result, elapsed } = timed(script);

    // Assert
    expect(script.length).toBeLessThanOrEqual(10_000);
    expect(result).not.toBeNull();
    expect(result?.match(/\\frac/g)).toHaveLength(520);
    expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
  });
});
