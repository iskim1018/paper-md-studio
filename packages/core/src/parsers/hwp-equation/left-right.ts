/**
 * `\left`·`\right` 짝 맞추기 (새로 작성 — kordoc·hml-equation-parser 에는 없다).
 *
 * LaTeX 는 같은 그룹 안에서 `\left` 와 `\right` 가 짝을 이루고 각각 뒤에
 * 구분자가 와야 한다. 한컴은 짝 없는 LEFT 도 받아 주므로, 그대로 옮기면
 * 수식 전체가 렌더링 오류가 된다. 짝 없는 쪽은 크기 지정만 버리고 구분자
 * 글자는 남기며, 구분자가 빠진 쪽에는 빈 구분자 `.` 를 넣는다.
 */
import { type EqToken, isClose, isOpen, isValue, makeToken } from "./tokens.js";

const DELIMITERS: ReadonlySet<string> = new Set([
  "(",
  ")",
  "[",
  "]",
  ".",
  "/",
  "<",
  ">",
  "⟨",
  "⟩",
  "\\lbrace",
  "\\rbrace",
  "\\vert",
  "\\Vert",
  "\\backslash",
  "\\langle",
  "\\rangle",
  "\\lfloor",
  "\\rfloor",
  "\\lceil",
  "\\rceil",
  "\\lgroup",
  "\\rgroup",
  "\\uparrow",
  "\\downarrow",
  "\\updownarrow",
  "\\Uparrow",
  "\\Downarrow",
  "\\Updownarrow",
]);

export function isSizer(token: EqToken | undefined): boolean {
  return isValue(token, "\\left") || isValue(token, "\\right");
}

function isDelimiter(token: EqToken | undefined): boolean {
  return (
    token !== undefined &&
    token.kind !== "literal" &&
    DELIMITERS.has(token.value)
  );
}

/** 그룹마다 아직 닫히지 않은 `\left` 인덱스를 쌓는 스택 */
interface SizerScan {
  readonly frames: Array<Array<number>>;
  readonly unmatched: Set<number>;
}

/** 그룹이 닫히면 그 안에서 짝을 못 찾은 `\left` 는 끝내 짝이 없다 */
function closeFrame(scan: SizerScan): void {
  if (scan.frames.length <= 1) return;
  for (const left of scan.frames.pop() ?? []) scan.unmatched.add(left);
}

function matchRight(scan: SizerScan, index: number): void {
  const frame = scan.frames.at(-1);
  if (frame !== undefined && frame.length > 0) frame.pop();
  else scan.unmatched.add(index);
}

/** 그룹 경계를 넘지 않고 짝을 찾지 못한 `\left`·`\right` 의 인덱스 */
function findUnmatchedSizers(tokens: ReadonlyArray<EqToken>): Set<number> {
  const scan: SizerScan = { frames: [[]], unmatched: new Set() };
  tokens.forEach((token, index) => {
    if (isOpen(token)) scan.frames.push([]);
    else if (isClose(token)) closeFrame(scan);
    else if (isValue(token, "\\left")) scan.frames.at(-1)?.push(index);
    else if (isValue(token, "\\right")) matchRight(scan, index);
  });
  for (const left of scan.frames.flat()) scan.unmatched.add(left);
  return scan.unmatched;
}

export function balanceLeftRight(
  tokens: ReadonlyArray<EqToken>,
): Array<EqToken> {
  const unmatched = findUnmatchedSizers(tokens);
  const balanced: Array<EqToken> = [];
  tokens.forEach((token, index) => {
    if (unmatched.has(index)) return;
    balanced.push(token);
    if (isSizer(token) && !isDelimiter(tokens[index + 1])) {
      balanced.push(makeToken("."));
    }
  });
  return balanced;
}

/** `\left` 위치에서 짝인 `\right` 의 인덱스. 없으면 -1 */
export function findMatchingRight(
  tokens: ReadonlyArray<EqToken>,
  left: number,
): number {
  let depth = 0;
  for (let i = left; i < tokens.length; i += 1) {
    if (isValue(tokens[i], "\\left")) depth += 1;
    else if (isValue(tokens[i], "\\right")) depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}
