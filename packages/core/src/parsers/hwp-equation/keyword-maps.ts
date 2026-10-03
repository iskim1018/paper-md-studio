/**
 * 인자를 받는 한컴 수식 예약어 — 행렬·장식·묶음괄호.
 *
 * 출처: kordoc 4.7.2 `src/hwpx/equation.ts` 의 MIDDLE_CONVERT_MAP·
 * BAR_CONVERT_MAP·MATRIX_CONVERT_MAP·BRACE_CONVERT_MAP
 * (MIT, Copyright (c) 2026 chrisryugj) — 그 원본은 OpenBapul/hml-equation-parser
 * `convertMap.json` (Apache-2.0, Copyright 2018 Open Bapul).
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - eqalign 을 `\eqalign{…}` 대신 `aligned` 환경으로 — KaTeX 가 `\eqalign` 을
 *   모른다 (2026-10-03 KaTeX 0.16.45 실측: Undefined control sequence).
 * - pile·lpile·rpile(세로 쌓기) 추가 — `array` 환경의 c/l/r 열.
 * - underbrace 라벨을 `^` 가 아니라 `_` 로 — 라벨이 괄호 아래에 붙는다.
 * - "바깥 중괄호 제거"(removeOutterBrackets) 를 없앴다. 행렬·장식을 감싼 그룹을
 *   통째로 바꿔치우면서 같은 그룹의 다른 내용(`{a + bar{x}}` 의 `a +`)이
 *   사라졌다. 남겨 둔 중괄호는 LaTeX 에서 무해하다.
 *
 * HULK* 표식은 원본과 같은 내부 표식이다 — 단일 토큰 치환 뒤 구조 패스가
 * 인자를 찾아 LaTeX 로 펼친다.
 */
import { lookup } from "./convert-map.js";

export const MIDDLE_CONVERT_MAP: Readonly<Record<string, string>> = {
  matrix: "HULKMATRIX",
  pmatrix: "HULKPMATRIX",
  bmatrix: "HULKBMATRIX",
  dmatrix: "HULKDMATRIX",
  eqalign: "HULKEQALIGN",
  cases: "HULKCASE",
  pile: "HULKPILE",
  lpile: "HULKLPILE",
  rpile: "HULKRPILE",
  vec: "HULKVEC",
  dyad: "HULKDYAD",
  acute: "HULKACUTE",
  grave: "HULKGRAVE",
  dot: "HULKDOT",
  ddot: "HULKDDOT",
  bar: "HULKBAR",
  hat: "HULKHAT",
  check: "HULKCHECK",
  arch: "HULKARCH",
  tilde: "HULKTILDE",
  BOX: "HULKBOX",
  OVERBRACE: "HULKOVERBRACE",
  UNDERBRACE: "HULKUNDERBRACE",
};

/** 장식 표식 → LaTeX 명령 (인자 1개) */
export const ACCENT_MAP: Readonly<Record<string, string>> = {
  HULKVEC: "\\overrightarrow",
  HULKDYAD: "\\overleftrightarrow",
  HULKACUTE: "\\acute",
  HULKGRAVE: "\\grave",
  HULKDOT: "\\dot",
  HULKDDOT: "\\ddot",
  HULKBAR: "\\overline",
  HULKHAT: "\\widehat",
  HULKCHECK: "\\check",
  HULKARCH: "\\overset{\\frown}",
  HULKTILDE: "\\widetilde",
  HULKBOX: "\\boxed",
};

export interface EnvironmentSpec {
  readonly begin: string;
  readonly end: string;
}

function environment(name: string, columns = ""): EnvironmentSpec {
  return { begin: `\\begin{${name}}${columns}`, end: `\\end{${name}}` };
}

/** 행렬류 표식 → LaTeX 환경 (인자 1개, 본문의 `#` 이 행 구분) */
export const MATRIX_MAP: Readonly<Record<string, EnvironmentSpec>> = {
  HULKMATRIX: environment("matrix"),
  HULKPMATRIX: environment("pmatrix"),
  HULKBMATRIX: environment("bmatrix"),
  HULKDMATRIX: environment("vmatrix"),
  HULKCASE: environment("cases"),
  HULKEQALIGN: environment("aligned"),
  HULKPILE: environment("array", "{c}"),
  HULKLPILE: environment("array", "{l}"),
  HULKRPILE: environment("array", "{r}"),
};

export interface BraceSpec {
  readonly command: string;
  /** 라벨을 붙이는 첨자 기호 — 위 묶음은 `^`, 아래 묶음은 `_` */
  readonly script: "^" | "_";
}

/** 묶음괄호 표식 (인자 2개: 본문, 라벨) */
export const BRACE_MAP: Readonly<Record<string, BraceSpec>> = {
  HULKOVERBRACE: { command: "\\overbrace", script: "^" },
  HULKUNDERBRACE: { command: "\\underbrace", script: "_" },
};

const ONE_ARGUMENT: ReadonlySet<string> = new Set([
  "\\sqrt",
  "\\underline",
  ...Object.keys(ACCENT_MAP),
  ...Object.keys(MATRIX_MAP),
]);

const TWO_ARGUMENTS: ReadonlySet<string> = new Set([
  "\\frac",
  ...Object.keys(BRACE_MAP),
]);

/** 명령 토큰 값이 받는 인자 수 (인자 없는 토큰은 0) */
export function arityOf(value: string): number {
  if (ONE_ARGUMENT.has(value)) return 1;
  if (TWO_ARGUMENTS.has(value)) return 2;
  return 0;
}

export function middleMarker(word: string): string | undefined {
  return lookup(MIDDLE_CONVERT_MAP, word);
}
