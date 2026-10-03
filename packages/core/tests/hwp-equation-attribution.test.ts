import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 수식 변환기는 kordoc(MIT)·hml-equation-parser(Apache-2.0)에서 온 코드다.
 * 배포물은 CLI 단일 파일 번들(minify)인데, esbuild 는 법적 주석(`@license`·
 * `/*!`)이 아닌 주석을 모두 지운다 — 출처 머리말이 평범한 `/** … *\/` 면
 * 번들에서 저작권 표기가 사라진다 (2026-10-03 실측: 번들에서 "Open Bapul" 0건).
 * 출처를 밝힌 파일은 머리말이 법적 주석이어야 번들 끝에 남는다.
 */
const EQUATION_DIR = join(
  import.meta.dirname,
  "..",
  "src",
  "parsers",
  "hwp-equation",
);

const UPSTREAM_COPYRIGHT = /chrisryugj|Open Bapul/;

function leadingComment(source: string): string {
  const match = /^\s*\/\*[\s\S]*?\*\//.exec(source);
  return match?.[0] ?? "";
}

const derivedFiles = readdirSync(EQUATION_DIR)
  .filter((name) => name.endsWith(".ts"))
  .filter((name) =>
    UPSTREAM_COPYRIGHT.test(readFileSync(join(EQUATION_DIR, name), "utf8")),
  );

describe("hwp-equation 출처 고지", () => {
  it("출처를 밝힌 파일이 있다 (목록이 비면 검사가 무의미하다)", () => {
    expect(derivedFiles.length).toBeGreaterThan(0);
  });

  it.each(derivedFiles)("%s 의 머리말은 번들에 남는 법적 주석이다", (name) => {
    // Arrange
    const header = leadingComment(
      readFileSync(join(EQUATION_DIR, name), "utf8"),
    );

    // Assert: 저작권 표기가 머리말 안에 있고, 머리말이 법적 주석이다
    expect(header).toMatch(UPSTREAM_COPYRIGHT);
    expect(header).toMatch(/@license|^\s*\/\*!/);
  });
});
