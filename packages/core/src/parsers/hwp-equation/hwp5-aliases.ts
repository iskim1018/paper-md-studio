/**
 * HWP5 원문 수식(EQEDIT) 표기 편차의 정규화 — 대소문자 무관 예약어·별칭.
 *
 * 출처: kordoc 4.7.2 `src/hwp5/equation.ts` 의 WORD_ALIASES·STRUCTURAL_FOLD·
 * normalizeWords·normalizeOperators (MIT, Copyright (c) 2026 chrisryugj).
 * 이 사전 정규화는 kordoc 이 실제 HWP5 문서에서 관측한 편차(소문자 예약어,
 * 붙여 쓴 연산자, 글꼴 지시자)를 hml-equation-parser(Apache-2.0,
 * Copyright 2018 Open Bapul) 계열 치환표가 알아듣는 꼴로 접는다.
 * rhwp 는 HWP5 스크립트를 <hp:script> 에 그대로 옮기므로 HWPX 경로에도 필요하다.
 *
 * 변경 사항 (Apache-2.0 §4(b)):
 * - 정규식 문자열 치환 대신 토큰 단위로 적용 — 따옴표 리터럴 안의 글자가
 *   예약어로 바뀌던 문제(`"sin"` → `\text{\sin}`)가 없다.
 * - sub/sup/from/to 를 `_`/`^` 로 (한컴 첨자·상하한 예약어), atop 추가.
 * - cdots/ldots/vdots/ddots 소문자 별칭 추가.
 */
import { CONVERT_MAP, lookup } from "./convert-map.js";
import { middleMarker } from "./keyword-maps.js";

/** 정본 치환표에 그 표기로는 없는 어휘 → LaTeX. 키는 소문자 */
const WORD_ALIASES: Readonly<Record<string, string>> = {
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  sec: "\\sec",
  csc: "\\csc",
  cot: "\\cot",
  log: "\\log",
  ln: "\\ln",
  divide: "\\div",
  div: "\\div",
  le: "\\leq",
  ge: "\\geq",
  geq: "\\geq",
  deg: "{}^{\\circ}",
  rarrow: "\\rightarrow",
  lrarrow: "\\leftrightarrow",
  rightarrow: "\\rightarrow",
  leftarrow: "\\leftarrow",
  in: "\\in",
  notin: "\\notin",
  emptyset: "\\emptyset",
  subset: "\\subset",
  nsubset: "\\nsubseteq",
  cup: "\\cup",
  cap: "\\cap",
  smallinter: "\\cap",
  smallsum: "\\sum",
  sim: "\\sim",
  circ: "\\circ",
  bot: "\\perp",
  partial: "\\partial",
  nabla: "\\nabla",
  angle: "\\angle",
  triangle: "\\triangle",
  inf: "\\infty",
  left: "\\left",
  right: "\\right",
  cdots: "\\cdots",
  ldots: "\\ldots",
  vdots: "\\vdots",
  ddots: "\\ddots",
  // 글꼴 지시자 — 버린다
  rm: "",
  it: "",
};

/** 구조 예약어 — 대소문자 무관 입력을 소문자로 접는다 */
const STRUCTURAL_KEYWORDS: ReadonlySet<string> = new Set([
  "over",
  "atop",
  "root",
  "of",
]);

/** 첨자·상하한 예약어 */
const SCRIPT_KEYWORDS: Readonly<Record<string, string>> = {
  sub: "_",
  sup: "^",
  from: "_",
  to: "^",
};

/** 붙여 쓴·유니코드 연산자 → LaTeX (정본 치환표보다 먼저 본다) */
const OPERATOR_ALIASES: Readonly<Record<string, string>> = {
  "+-": "\\pm",
  "-+": "\\mp",
  "//": "\\parallel",
  "!=": "\\neq",
  "<=": "\\leq",
  ">=": "\\geq",
  "==": "\\equiv",
  "△": "\\triangle",
  "□": "\\square",
  "‧": "\\cdot",
};

function exactKeyword(word: string): string | undefined {
  return lookup(CONVERT_MAP, word) ?? middleMarker(word);
}

/**
 * 단어 토큰 하나를 LaTeX 조각·구조 예약어·내부 표식으로 바꾼다.
 * 정본 키가 정확히 맞으면 그것이 우선이고(대소문자로 뜻이 갈리는 GAMMA/gamma,
 * RARROW/rarrow), 아니면 소문자로 접어 별칭을 찾는다. 모르는 단어는 그대로.
 * 빈 문자열은 "버린다"는 뜻이다.
 */
export function resolveWord(word: string): string {
  const exact = exactKeyword(word);
  if (exact !== undefined) return exact;
  const lower = word.toLowerCase();
  if (STRUCTURAL_KEYWORDS.has(lower)) return lower;
  const folded =
    lookup(SCRIPT_KEYWORDS, lower) ??
    lookup(WORD_ALIASES, lower) ??
    (lower === word ? undefined : exactKeyword(lower));
  return folded ?? word;
}

/** 연산자·기호 토큰 하나를 LaTeX 로 (모르면 그대로) */
export function resolveOperator(symbol: string): string {
  return (
    lookup(OPERATOR_ALIASES, symbol) ?? lookup(CONVERT_MAP, symbol) ?? symbol
  );
}
