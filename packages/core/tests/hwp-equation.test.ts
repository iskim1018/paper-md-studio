import { describe, expect, it } from "vitest";
import { hwpEquationToLatex } from "../src/parsers/hwp-equation/index.js";

/**
 * 한컴 수식 스크립트(<hp:script>, HWP5 EQEDIT) → LaTeX.
 *
 * 벡터는 자체 작성이다. 원 알고리즘의 출처인 OpenBapul/hml-equation-parser
 * (Apache-2.0) 저장소에는 테스트 스위트가 없고(2026-10-03 확인), README 의
 * 사용 예 하나(`LEFT ⌊ a+b RIGHT ⌋`)만 아래 "괄호" 묶음에 옮겨 두었다.
 *
 * 출력 공백은 원문 인접 관계를 따른다 — LaTeX 는 수식 모드 공백을 무시하므로
 * 의미는 같고, 기대값을 문자열로 고정해 회귀를 잡는 것이 목적이다.
 */

type Vector = readonly [title: string, script: string, latex: string];

function runVectors(vectors: ReadonlyArray<Vector>): void {
  it.each(vectors)("%s", (_title, script, latex) => {
    // Act
    const result = hwpEquationToLatex(script);

    // Assert
    expect(result).toBe(latex);
  });
}

describe("hwpEquationToLatex — 분수", () => {
  runVectors([
    ["중괄호 분자·분모", "{1} over {2}", "\\frac{1}{2}"],
    ["괄호 없는 인접 토큰", "a over bc", "\\frac{a}{bc}"],
    [
      "근의 공식",
      "x = {-b +- sqrt {b^2 -4ac}} over {2a}",
      "x = \\frac{-b \\pm \\sqrt{b^{2} -4ac}}{2a}",
    ],
    ["중첩 분수", "{{1} over {2}} over {3}", "\\frac{\\frac{1}{2}}{3}"],
    [
      "연속 over 는 왼쪽부터 묶는다",
      "a over b over c",
      "\\frac{\\frac{a}{b}}{c}",
    ],
    [
      "분자는 over 바로 앞 항만 — 앞 내용을 삼키지 않는다",
      "sqrt {x} + 1 over 2",
      "\\sqrt{x} + \\frac{1}{2}",
    ],
    ["연산자에서 분자가 끊긴다", "y=a over b", "y=\\frac{a}{b}"],
    ["분모의 sqrt 는 인자까지 함께", "1 over sqrt {x}", "\\frac{1}{\\sqrt{x}}"],
    ["분자가 없어도 유효한 LaTeX", "over 2", "\\frac{}{2}"],
    ["atop 은 분수선 없는 분수", "n atop k", "{n \\atop k}"],
    // \atop 은 그룹 하나에 하나뿐인 중위 연산자 — 양쪽을 그룹으로 나눈다
    ["연속 atop", "a atop b atop c", "{{a \\atop b} \\atop c}"],
    // 첨자 인자 그룹만 분자로 떼어 가면 `_\frac` 처럼 인자 없는 첨자가 남는다
    ["밑 없는 첨자 뒤 over", "= _{a} over b", "= \\frac{_{a}}{b}"],
  ]);
});

/**
 * 괄호 안·계승·프라임 뒤의 분자 — 출력이 유효한 LaTeX 라 렌더 오류도 경고도
 * 없이 뜻만 틀어지던 자리다 (`(1+ 1 \frac{}{n})`, `f'\frac{(x)}{g'}(x)`).
 */
describe("hwpEquationToLatex — 분수 (괄호 안·계승·프라임)", () => {
  runVectors([
    [
      "e 의 정의 — 소괄호 안의 분수",
      "lim _{n->INF} (1+ 1 over n)^n = e",
      "\\lim_{n \\rightarrow \\infty} (1+ \\frac{1}{n})^{n} = e",
    ],
    ["띄어 쓴 소괄호 안", "( 1 over 2 )^x", "(\\frac{1}{2})^{x}"],
    ["붙여 쓴 소괄호 안", "(1 over 2)", "(\\frac{1}{2})"],
    ["함수 인자 괄호 안", "sin (pi over 6)", "\\sin (\\frac{\\pi}{6})"],
    [
      "중괄호 분자·분모가 소괄호 안",
      "( {1} over {2} )^x",
      "(\\frac{1}{2})^{x}",
    ],
    [
      "소괄호 안 앞 내용은 남긴다",
      "(1+ {1} over {n})^n",
      "(1+ \\frac{1}{n})^{n}",
    ],
    ["대괄호 안", "[a over b]", "[\\frac{a}{b}]"],
    ["앞 항과 띄운 괄호", "x (a over b)", "x (\\frac{a}{b})"],
    ["앞 항에 붙은 괄호", "2(1 over n)", "2(\\frac{1}{n})"],
    ["쉼표 뒤만 분자", "(a, b over c)", "(a, \\frac{b}{c})"],
    ["괄호 안 괄호", "( ( a over b ) over c )", "(\\frac{(\\frac{a}{b})}{c})"],
    ["root 지수 안의 분수", "root {a over b} of x", "\\sqrt[\\frac{a}{b}]{x}"],
    ["계승 분자", "n! over 2", "\\frac{n!}{2}"],
    ["계승 분자·분모", "(n+1)! over n!", "\\frac{(n+1)!}{n!}"],
    ["이중 계승", "n!! over 2", "\\frac{n!!}{2}"],
    ["첨자 뒤 계승", "x^2! over 2", "\\frac{x^{2}!}{2}"],
    ["도함수의 몫", "f'(x) over g'(x)", "\\frac{f'(x)}{g'(x)}"],
    ["도함수 분자", "g'(x) over g(x)", "\\frac{g'(x)}{g(x)}"],
    ["이계도함수", "f''(x) over 2", "\\frac{f''(x)}{2}"],
    ["근호 인자의 도함수", "sqrt f'(x)", "\\sqrt{f'(x)}"],
    ["atop 도 소괄호 안", "(a atop b)", "({a \\atop b})"],
    ["계승 분모", "1 over n!", "\\frac{1}{n!}"],
    ["장식 뒤 계승은 분자째", "bar{n}! over 2", "\\frac{\\overline{n}!}{2}"],
    // 짝 없는 괄호는 항을 넘지 않는다 — 바뀌지 않아야 하는 기존 동작
    ["닫히지 않은 소괄호", "(a over b", "\\frac{(a}{b}"],
    ["반열린 구간", "[0, 1 over 2)", "[0, \\frac{1}{2})"],
  ]);
});

/**
 * 계승은 분수의 분자·분모에서만 앞 항에 붙인다. 명령 인자로 넣으면 장식·근호·
 * 행렬이 `!` 까지 덮는다 (`\overline{{n}!}`). 프라임 뒤 결합도 밑이 붙여 쓰는
 * 원자일 때만 — 그룹은 원래 이웃과 붙지 않는다.
 */
describe("hwpEquationToLatex — 계승·프라임이 명령 인자로 번지지 않는다", () => {
  runVectors([
    ["장식 뒤 계승", "bar{n}!", "\\overline{n}!"],
    ["근호 뒤 계승", "sqrt n!", "\\sqrt{n}!"],
    [
      "행렬 뒤 계승",
      "bmatrix{1&2#3&4}!",
      "\\begin{bmatrix} 1&2 \\\\ 3&4 \\end{bmatrix} !",
    ],
    ["그룹 밑의 프라임 뒤는 잇지 않는다", "{f}'(x)", "{f}'(x)"],
  ]);
});

describe("hwpEquationToLatex — 근호", () => {
  runVectors([
    ["sqrt", "sqrt {x+1}", "\\sqrt{x+1}"],
    ["괄호 없는 sqrt 인자는 붙은 토큰까지", "sqrt 2x", "\\sqrt{2x}"],
    ["root of", "root {3} of {x+1}", "\\sqrt[3]{x+1}"],
    ["괄호 없는 root of", "root 3 of x", "\\sqrt[3]{x}"],
    // KaTeX 는 `{` 로 시작하는 옵션 인자를 잘못 읽는다 — 그때만 한 겹 더 감싼다
    [
      "지수가 그룹으로 시작하는 root",
      "root {{a}_1} of x",
      "\\sqrt[{{a}_{1}}]{x}",
    ],
  ]);
});

describe("hwpEquationToLatex — 첨자", () => {
  runVectors([
    ["아래첨자", "x_1", "x_{1}"],
    ["위첨자", "x^2", "x^{2}"],
    ["괄호 없는 위첨자는 연산자에서 끊는다", "x^2+1", "x^{2}+1"],
    ["음수 지수", "10^-3", "10^{-3}"],
    ["sub/sup 예약어", "x sup 2 sub 1", "x^{2}_{1}"],
    ["sum from to", "sum from {k=1} to n a_k", "\\sum_{k=1}^{n} a_{k}"],
    ["int 상하한", "int _{0} ^{1} f(x) dx", "\\int_{0}^{1} f(x) dx"],
    ["prod 상하한", "prod _{i=1} ^{n} x_i", "\\prod_{i=1}^{n} x_{i}"],
    ["같은 첨자가 겹치면 안쪽으로", "x^a^b", "x^{a^{b}}"],
    // LaTeX 의 "Double superscript" 오류 — 빈 밑 {} 를 넣어 피한다
    ["위첨자 뒤 프라임", "x^2 prime", "x^{2}{}'"],
    ["위첨자로 끝나는 DEG 뒤 위첨자", "30 DEG ^2", "30{}^{\\circ}{}^{2}"],
  ]);
});

describe("hwpEquationToLatex — 그리스 문자·연산자", () => {
  runVectors([
    ["그리스 소문자", "alpha + beta + omega", "\\alpha + \\beta + \\omega"],
    ["그리스 대문자", "GAMMA DELTA PI OMEGA", "\\Gamma \\Delta \\Pi \\Omega"],
    ["라틴 글자와 같은 대문자 그리스", "ALPHA BETA", "A B"],
    ["곱셈", "a times b cdot c", "a \\times b \\cdot c"],
    [
      "붙여 쓴 비교 연산자",
      "a<=b, c!=d, e>=f",
      "a \\leq b, c \\neq d, e \\geq f",
    ],
    ["±", "a +- b", "a \\pm b"],
    ["화살표와 대문자 INF", "x rarrow INF", "x \\rightarrow \\infty"],
    ["-> 와 소문자 inf", "n -> inf", "n \\rightarrow \\infty"],
    [
      "삼각·로그 함수 (대소문자 무관)",
      "sin x + COS y + log z",
      "\\sin x + \\cos y + \\log z",
    ],
    ["글꼴 지시자 rm/it 는 버린다", "rm A it B", "A B"],
    ["퍼센트는 주석이 되지 않게 이스케이프", "100 %", "100 \\%"],
    ["도(°)는 이중 위첨자를 만들지 않는다", "30 DEG", "30{}^{\\circ}"],
    ["프라임은 붙여 쓴다", "f'(x) + g''", "f'(x) + g''"],
    ["역따옴표는 공백", "a`b", "a b"],
    // 한컴 수식에는 백슬래시 명령이 없다 — 정의되지 않은 LaTeX 명령을 막는다
    ["백슬래시는 글자", "a \\ b", "a \\backslash b"],
    ["백슬래시 뒤 예약어", "\\alpha", "\\backslash \\alpha"],
  ]);
});

describe("hwpEquationToLatex — 큰 연산자", () => {
  runVectors([
    [
      "lim 아래첨자",
      "lim _{n rarrow inf} a_n",
      "\\lim_{n \\rightarrow \\infty} a_{n}",
    ],
    [
      "lim 뒤의 분수",
      "lim from {x -> 0} {sin x} over x",
      "\\lim_{x \\rightarrow 0} \\frac{\\sin x}{x}",
    ],
  ]);
});

describe("hwpEquationToLatex — 행렬·조건식", () => {
  runVectors([
    [
      "matrix",
      "matrix{1 & 2 # 3 & 4}",
      "\\begin{matrix} 1 & 2 \\\\ 3 & 4 \\end{matrix}",
    ],
    [
      "pmatrix 붙여 쓰기",
      "pmatrix{a&b#c&d}",
      "\\begin{pmatrix} a&b \\\\ c&d \\end{pmatrix}",
    ],
    [
      "bmatrix 의 XML 엔티티 &amp;",
      "bmatrix{1&amp;2#3&amp;4}",
      "\\begin{bmatrix} 1&2 \\\\ 3&4 \\end{bmatrix}",
    ],
    [
      "dmatrix 는 vmatrix",
      "dmatrix{a & b # c & d}",
      "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}",
    ],
    [
      "행렬을 감싼 그룹의 다른 내용을 지우지 않는다",
      "{ a + matrix{1 # 2} }",
      "{a + \\begin{matrix} 1 \\\\ 2 \\end{matrix}}",
    ],
    [
      "cases",
      "f(x) = cases{x & x>=0 # -x & x<0}",
      "f(x) = \\begin{cases} x & x \\geq 0 \\\\ -x & x<0 \\end{cases}",
    ],
    [
      "eqalign 은 KaTeX 가 아는 aligned 로",
      "eqalign{a & = b # c & = d}",
      "\\begin{aligned} a & = b \\\\ c & = d \\end{aligned}",
    ],
    ["pile", "pile{a # b}", "\\begin{array}{c} a \\\\ b \\end{array}"],
    [
      "괄호 항은 행렬의 & 를 넘지 않는다",
      "matrix{sqrt (a & b)}",
      "\\begin{matrix} \\sqrt{(a} & b) \\end{matrix}",
    ],
  ]);
});

describe("hwpEquationToLatex — 장식·묶음", () => {
  runVectors([
    ["vec·hat", "vec{a} + hat {b}", "\\overrightarrow{a} + \\widehat{b}"],
    ["괄호 없는 bar", "bar x", "\\overline{x}"],
    ["dot·ddot", "dot{y} + ddot{z}", "\\dot{y} + \\ddot{z}"],
    ["tilde", "tilde{n}", "\\widetilde{n}"],
    [
      "장식을 감싼 그룹의 다른 내용을 지우지 않는다",
      "{ a + bar{x} }",
      "{a + \\overline{x}}",
    ],
    ["overbrace", "OVERBRACE {a+b} {n}", "\\overbrace{a+b}^{n}"],
    [
      "underbrace 는 라벨이 아래",
      "UNDERBRACE {x+y} {m}",
      "\\underbrace{x+y}_{m}",
    ],
  ]);
});

describe("hwpEquationToLatex — 따옴표 리터럴·한글", () => {
  runVectors([
    ["공백 있는 리터럴", '"hello world" + x', "\\text{hello world} + x"],
    ["예약어도 리터럴이면 글자 그대로", '"over" a', "\\text{over} a"],
    [
      "리터럴 안 LaTeX 특수문자 이스케이프",
      '"50% & 1$"',
      "\\text{50\\% \\& 1\\textdollar{}}",
    ],
    ["따옴표 없는 한글은 \\text", "가격 = 100", "\\text{가격} = 100"],
    // 역따옴표는 Markdown 코드 스팬을 열 수 있어 모양이 같은 ˋ(U+02CB)로
    ["리터럴 안 역따옴표", '"a`b"', "\\text{a\u02cbb}"],
  ]);
});

describe("hwpEquationToLatex — 괄호", () => {
  runVectors([
    [
      "LEFT ( RIGHT )",
      "LEFT ( a over b RIGHT )",
      "\\left(\\frac{a}{b} \\right)",
    ],
    [
      "LEFT { 는 \\lbrace",
      "LEFT { x RIGHT }",
      "\\left\\lbrace x \\right\\rbrace",
    ],
    // hml-equation-parser README 사용 예 — 업스트림 출력과 공백만 다르다
    [
      "LEFT ⌊ RIGHT ⌋",
      "LEFT ⌊ a+b RIGHT ⌋",
      "\\left\\lfloor a+b \\right\\rfloor",
    ],
    ["짝 없는 LEFT 는 버린다", "LEFT ( x", "(x"],
  ]);
});

describe("hwpEquationToLatex — 표 셀 안전성 (파이프)", () => {
  runVectors([
    ["단독 파이프", "a | b", "a \\vert b"],
    ["LEFT | RIGHT |", "LEFT | x RIGHT |", "\\left\\vert x \\right\\vert"],
    ["조건부 확률", "P(A|B)", "P(A \\vert B)"],
    ["리터럴 안 파이프", '"a|b"', "\\text{a\\textbar{}b}"],
    ["PVER 는 \\Vert", "PVER x PVER", "\\Vert x \\Vert"],
  ]);
});

describe("hwpEquationToLatex — 줄바꿈 #", () => {
  runVectors([
    [
      "최상위 # 는 gathered 의 줄",
      "a # b",
      "\\begin{gathered} a \\\\ b \\end{gathered}",
    ],
    [
      "& 정렬이 있으면 aligned",
      "a & = b # c & = d",
      "\\begin{aligned} a & = b \\\\ c & = d \\end{aligned}",
    ],
    ["줄바꿈 없는 & 는 버린다", "a & b", "a b"],
    [
      "그룹 안의 # 도 그 그룹 안에서 줄을 만든다",
      "{a # b} over c",
      "\\frac{\\begin{gathered} a \\\\ b \\end{gathered}}{c}",
    ],
    ["끝에 붙은 # 는 빈 줄을 만들지 않는다", "a #", "a"],
    [
      "CRLF 가 섞인 여러 줄",
      "a #\r\nb",
      "\\begin{gathered} a \\\\ b \\end{gathered}",
    ],
  ]);
});

describe("hwpEquationToLatex — 실물 형태의 긴 스크립트", () => {
  it("행렬 수열의 극한 (합성 스크립트, 약 200자)", () => {
    // Arrange: 실물 문서의 구조(# 줄바꿈 + bmatrix + over + lim/rarrow/INF +
    // 역따옴표 공백 + CRLF)만 본뜬 자체 작성 스크립트
    const script =
      "A_n = {1} over {n} bmatrix{n & 1 # 0 & n}#\r\n" +
      "lim _{n rarrow INF} {A_n} = bmatrix{1 & 0 # 0 & 1}#\r\n" +
      '{n^2 + 1} over {n^2} `rarrow` 1 ~ "(수렴)" ,`` ' +
      "sum from {k=1} to n {1} over {k^2} < INF `cdot` 2^-1";

    // Act
    const result = hwpEquationToLatex(script);

    // Assert
    expect(script.length).toBeGreaterThanOrEqual(190);
    expect(result).toBe(
      "\\begin{gathered} " +
        "A_{n} = \\frac{1}{n} \\begin{bmatrix} n & 1 \\\\ 0 & n \\end{bmatrix}" +
        " \\\\ " +
        "\\lim_{n \\rightarrow \\infty}{A_{n}} = " +
        "\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}" +
        " \\\\ " +
        "\\frac{n^{2} + 1}{n^{2}} \\rightarrow 1 \\; \\text{(수렴)}, " +
        "\\sum_{k=1}^{n} \\frac{1}{k^{2}} < \\infty \\cdot 2^{-1}" +
        " \\end{gathered}",
    );
  });
});

describe("hwpEquationToLatex — 빈 입력", () => {
  it.each([
    ["빈 문자열", ""],
    ["공백", "   "],
    ["개행·탭", "\r\n\t"],
    ["역따옴표만", "``"],
    ["빈 그룹", "{}"],
    ["간격 기호만", "~ ~"],
  ])("%s → null", (_title, script) => {
    expect(hwpEquationToLatex(script)).toBeNull();
  });

  it("문자열이 아닌 값이 들어와도 던지지 않고 null", () => {
    // Arrange: 호출측 XML 파서가 숫자·객체를 넘기는 경우 방어
    const notAString = 42 as unknown as string;

    // Act & Assert
    expect(hwpEquationToLatex(notAString)).toBeNull();
  });
});

describe("hwpEquationToLatex — 견고성", () => {
  /** 출력이 GFM 표 셀·인라인 $…$ 에 그대로 들어가도 안전한지 */
  function expectEmbeddable(result: string | null): void {
    if (result === null) return;
    expect(result).not.toMatch(/[\r\n|$`]/);
    expect(result).not.toContain("HULK");
    expect(result).not.toContain("function");
    expect(result).toBe(result.trim());
    expect(braceDepthIsBalanced(result)).toBe(true);
  }

  function braceDepthIsBalanced(latex: string): boolean {
    let depth = 0;
    for (const ch of latex.replace(/\\[{}]/g, "")) {
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  it.each([
    "}}}{{{",
    "over over over",
    "root",
    "root of",
    "matrix{",
    "LEFT",
    "RIGHT )",
    '"',
    "^_^",
    "#&#&",
    "\\",
    "\\\\\\",
    'a"b',
    "a over",
    "cases{ # # }",
    "OVERBRACE",
    "{".repeat(500),
    "sqrt ".repeat(300),
  ])("이상한 입력 %j 에도 던지지 않는다", (script) => {
    // Act
    const run = () => hwpEquationToLatex(script);

    // Assert
    expect(run).not.toThrow();
    expectEmbeddable(run());
  });

  it("Object.prototype 키 이름의 토큰을 함수로 치환하지 않는다", () => {
    // Act
    const result = hwpEquationToLatex("constructor + toString");

    // Assert
    expect(result).toBe("constructor + toString");
  });

  it("무작위 조합 500개 모두 던지지 않고 표 셀에 넣을 수 있는 출력을 낸다", () => {
    // Arrange: 시드 고정 의사난수 — 실패가 재현되도록
    const alphabet = [
      ..."{ } # & ^ _ ( ) | ' ~ ` $ % \\ 가 <= +- &amp;".split(" "),
      ..."over atop root of sqrt matrix cases bmatrix eqalign pile".split(" "),
      ..."bar vec OVERBRACE LEFT RIGHT x 1 alpha sum from to rm PVER".split(
        " ",
      ),
      '"',
      " ",
      "\r\n",
    ];
    const random = mulberry32(20261003);
    const pick = (): string =>
      alphabet[Math.floor(random() * alphabet.length)] ?? "";

    for (let n = 0; n < 500; n += 1) {
      const length = 1 + Math.floor(random() * 40);
      const script = Array.from({ length }, () =>
        random() < 0.5 ? pick() : `${pick()} `,
      ).join("");

      // Act
      const result = hwpEquationToLatex(script);

      // Assert
      expectEmbeddable(result);
    }
  });

  it("10,000자에 가까운 입력도 1초 안에 끝난다", () => {
    // Arrange: 실측 약 30ms(2026-10-03) — 30배 여유를 둔 예산이라 부하에 흔들리지
    // 않는다. 목적은 속도 측정이 아니라 패스가 폭증(2차 이상)하는 순간을 잡는 것
    const script = "{a over b} ^ {x_1} # ".repeat(450);

    // Act
    const started = performance.now();
    const result = hwpEquationToLatex(script);
    const elapsed = performance.now() - started;

    // Assert
    expect(elapsed).toBeLessThan(1000);
    expectEmbeddable(result);
  });
});

/** 시드 고정 32비트 의사난수 (mulberry32) */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
