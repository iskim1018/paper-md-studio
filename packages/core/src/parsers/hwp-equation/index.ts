/**
 * 한컴 수식 스크립트 → LaTeX.
 *
 * 입력은 HWPX `<hp:equation><hp:script>` 의 텍스트, 또는 HWP5 EQEDIT 레코드의
 * 스크립트다 (rhwp 는 HWP5 스크립트를 <hp:script> 에 그대로 옮긴다). 같은
 * 한컴 수식 언어라 한 경로로 처리한다.
 *
 * 출처
 * - kordoc 4.7.2 `src/hwpx/equation.ts`·`src/hwp5/equation.ts`
 *   (MIT License, Copyright (c) 2026 chrisryugj)
 * - 위 hwpx/equation.ts 의 원본: OpenBapul/hml-equation-parser
 *   `hulkEqParser.py`·`hulkReplaceMethod.py`·`convertMap.json`
 *   (Apache License 2.0, Copyright 2018 Open Bapul). 업스트림 저장소에는
 *   NOTICE 파일이 없다 (2026-10-03 확인).
 * @license kordoc: MIT · hml-equation-parser: Apache-2.0 — 전문은 THIRD_PARTY_LICENSES.md
 *
 * 변경 사항 (Apache-2.0 §4(b)) — 각 파일 머리말에 자세히 적었다.
 * - TypeScript 토큰 배열 기반으로 다시 썼다 (원본은 문자열 인덱스 치환).
 * - HWP5 사전 정규화(대소문자 무관 예약어·붙여 쓴 연산자)를 먼저 적용한다.
 * - 괄호 없는 인자를 한컴의 항 규칙으로 묶는다 (분모·근호·첨자·장식).
 * - 행렬·장식을 감싼 그룹의 다른 내용을 지우던 문제를 없앴다.
 * - 최상위 `#` 를 gathered/aligned 의 줄로 바꾼다 (원본은 `#` 가 새어 나왔다).
 * - eqalign 을 aligned 로, underbrace 라벨을 아래로, pile·atop·from/to 추가.
 * - `|`·`$`·`%`·역따옴표·개행을 막아 GFM 표 셀과 인라인 수식에 그대로 넣을 수
 *   있게 했다. 한글은 `\text{}` 로, `\` 는 `\backslash` 로 (한컴에는 명령 접두사가 아니다).
 * - 짝 없는 중괄호·`\left`·`\right`, 이중 첨자를 바로잡아 렌더러가 수식 전체를
 *   버리지 않게 한다 (2026-10-03 KaTeX 0.16.45 로 무작위 스크립트 60만 건 오류 0).
 * - 예외를 던지지 않는다 — 실패하면 null 을 돌려주고 호출측이 원문을 쓴다.
 * - 작업량·중첩 한도(budget.ts)를 넘으면 변환하지 않는다 — 서버에서 수식
 *   하나가 이벤트 루프를 막지 않게 (짝 없는 괄호를 쌓은 9,900자에 417초였다).
 */
import { assertShallowEnough, runWithinBudget } from "./budget.js";
import { separateDoubleScripts } from "./double-scripts.js";
import { balanceLeftRight } from "./left-right.js";
import { decodeXmlEntities, lex } from "./lexer.js";
import { rewriteLineBreaks } from "./line-breaks.js";
import { mapTokens } from "./map-tokens.js";
import { hasVisibleContent, renderTokens } from "./render.js";
import { wrapArguments } from "./rewrite-arguments.js";
import { rewriteFractions, rewriteRoots } from "./rewrite-fractions.js";
import {
  rewriteAccents,
  rewriteBraces,
  rewriteMatrices,
} from "./rewrite-structures.js";
import { balanceBraces, type EqToken } from "./tokens.js";

/** 실물 수식은 길어야 수천 자다 — 이보다 길면 변환하지 않고 원문 폴백에 맡긴다 */
const MAX_SCRIPT_LENGTH = 10_000;

/**
 * 토큰 방문 수 상한. 실물 모양으로 10,000자를 채운 스크립트(분수 520개, 행렬
 * 속 분수, 극한·합 혼합)가 약 14만 걸음이다 (2026-10-03 실측) — 7배 남짓 둔다.
 * 이 한도에서 멈추면 변환은 수십 ms 안에 끝난다.
 */
const MAX_STEPS = 1_000_000;

/**
 * 구조·재귀 중첩 깊이 상한. 실물 수식은 깊어야 수십 단계(연분수·중첩 첨자)다.
 * 수천 단계면 콜 스택이 넘치고 단계마다 꼬리를 복사하는 패스가 O(n·깊이) 가 된다.
 */
const MAX_NESTING_DEPTH = 100;

type Pass = (tokens: ReadonlyArray<EqToken>) => Array<EqToken>;

/** 순서가 의미를 가진다 — 각 패스는 앞 패스가 보장한 형태를 전제한다 */
const PASSES: ReadonlyArray<Pass> = [
  mapTokens,
  balanceBraces,
  balanceLeftRight,
  wrapArguments,
  rewriteRoots,
  rewriteFractions,
  // 인자 감싸기·분수가 새 그룹을 만들었으니 짝을 다시 확인한다
  balanceLeftRight,
  rewriteMatrices,
  rewriteAccents,
  rewriteBraces,
  rewriteLineBreaks,
  separateDoubleScripts,
  balanceBraces,
];

/** 각 패스 뒤에 깊이를 본다 — 다음 패스의 재귀가 그 깊이를 따른다 */
function runPass(current: ReadonlyArray<EqToken>, pass: Pass): Array<EqToken> {
  const next = pass(current);
  assertShallowEnough(next);
  return next;
}

function convert(script: string): string | null {
  const source = decodeXmlEntities(script.replace(/\0/g, ""));
  const tokens = PASSES.reduce<ReadonlyArray<EqToken>>(runPass, lex(source));
  const latex = renderTokens(tokens);
  return hasVisibleContent(latex) ? latex : null;
}

/**
 * 한컴 수식 스크립트를 LaTeX 로 바꾼다 (`$` 구분자 없이, 앞뒤 공백 없이).
 * 빈 입력이거나 의미 있는 결과를 만들 수 없으면 null. 예외는 던지지 않는다.
 */
export function hwpEquationToLatex(script: string): string | null {
  if (typeof script !== "string") return null;
  if (script.trim() === "" || script.length > MAX_SCRIPT_LENGTH) return null;
  try {
    return runWithinBudget({ steps: MAX_STEPS, depth: MAX_NESTING_DEPTH }, () =>
      convert(script),
    );
  } catch {
    // 결함·한도 초과 모두 null — 호출측이 원문을 코드로 남기고 경고한다
    return null;
  }
}
