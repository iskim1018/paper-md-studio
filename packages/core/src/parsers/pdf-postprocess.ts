/**
 * pdf2md 가 만든 Markdown 의 마무리 손질.
 *
 * 텍스트 런 수준(`pdf-text-runs.ts`)에서 못 잡는, 줄 단위로만 판단할 수 있는
 * 잔재를 정리한다.
 */

/** 목차 점선 리더로 쓰이는 문자들 */
const LEADER_CHARS = ".·․‥…";

/**
 * 목차 줄 — `제목 ······ 쪽번호` 형태.
 *
 * pdf2md 는 글자 크기만 보고 목차 줄을 제목(`####`)으로 오인식한다. 그대로 두면
 * 실제 본문 제목과 뒤섞여 문서 개요가 통째로 망가지므로 목록 항목으로 낮춘다.
 */
const TOC_ENTRY = new RegExp(
  `^(#{1,6}\\s+)?(.+?)\\s*[${LEADER_CHARS}]{4,}\\s*(\\d+)$`,
);

/** 목차 줄에서 제목과 쪽번호를 잇는 구분자 */
const TOC_SEPARATOR = " — ";

/** 목차 한 단계를 들여쓸 칸 수 */
const TOC_INDENT_WIDTH = 2;

/** 점선 리더가 붙은 목차 줄에서 뽑아낸 정보 */
interface TocEntry {
  title: string;
  pageNumber: string;
  /** 원래 붙어 있던 제목 단계 (`####` → 4). 제목 표기가 없었으면 null */
  headingLevel: number | null;
}

/**
 * PDF 에서 뽑아낸 Markdown 의 줄 단위 잔재를 정리합니다.
 *
 * - 점선 리더가 붙은 목차 줄을 목록 항목으로 정규화 (장/절 계층은 들여쓰기로 보존)
 * - 제목으로 잘못 승격된 본문·표 행을 되돌림
 * - 줄 끝 공백 제거
 * - pdf2md 가 문단마다 붙이는 앞 공백 한 칸 제거 (의미 있는 들여쓰기는 보존)
 */
export function cleanupPdfMarkdown(markdown: string): string {
  const lines = markdown.split("\n").map(trimEdges);
  const entries = lines.map(parseTocEntry);
  const depthByLevel = rankHeadingLevels(entries);

  const withToc = lines.map((line, index) => {
    const entry = entries[index];
    return entry ? renderTocEntry(entry, depthByLevel) : line;
  });

  return demoteFalseHeadings(withToc).join("\n");
}

/** 점선 리더가 붙은 목차 줄이면 그 구성 요소를, 아니면 null 을 돌려줍니다. */
function parseTocEntry(line: string): TocEntry | null {
  const matched = TOC_ENTRY.exec(line);
  if (!matched) {
    return null;
  }

  const [, headingMarker, title, pageNumber] = matched;
  if (!title || !pageNumber) {
    return null;
  }

  return {
    title,
    pageNumber,
    headingLevel: headingMarker ? headingMarker.trimEnd().length : null,
  };
}

/**
 * 목차 줄들이 실제로 쓴 제목 단계를 0부터의 중첩 깊이로 매깁니다.
 *
 * pdf2md 의 단계는 글자 크기에서 나오므로 `####` 다음이 `######` 인 식으로 띄엄띄엄
 * 붙는다. 단계 차이를 그대로 들여쓰면 금세 코드 블록으로 오인식될 만큼 깊어지므로
 * 등장한 단계들의 순위로 바꾼다.
 */
function rankHeadingLevels(
  entries: ReadonlyArray<TocEntry | null>,
): Map<number, number> {
  const levels = entries
    .map((entry) => entry?.headingLevel)
    .filter((level): level is number => level !== undefined && level !== null);

  const ascending = [...new Set(levels)].sort((a, b) => a - b);
  return new Map(ascending.map((level, depth) => [level, depth]));
}

/** 목차 항목을 계층이 보이는 목록 항목으로 씁니다. */
function renderTocEntry(
  entry: TocEntry,
  depthByLevel: ReadonlyMap<number, number>,
): string {
  const depth =
    entry.headingLevel === null
      ? 0
      : (depthByLevel.get(entry.headingLevel) ?? 0);
  const indent = " ".repeat(depth * TOC_INDENT_WIDTH);

  return `${indent}- ${entry.title}${TOC_SEPARATOR}${entry.pageNumber}`;
}

/** 변환기가 넣은 구조 표시 (페이지 구분 주석 등) — 사람이 읽을 내용이 아니다 */
const STRUCTURAL_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * 변환 결과에 사람이 읽을 텍스트가 남았는지 판정합니다.
 *
 * 텍스트 레이어가 없는 스캔 PDF 는 페이지 구분 주석만 남은 결과를 낸다. 그대로
 * 두면 "성공했는데 내용이 없는" 상태가 되어 사용자가 원인을 알 수 없으므로,
 * 호출부에서 이 판정으로 경고를 붙인다.
 */
export function hasExtractableText(markdown: string): boolean {
  return markdown.replace(STRUCTURAL_COMMENT, "").trim() !== "";
}

/** 제목 줄 — 마커와 내용 */
const HEADING_LINE = /^(#{1,6})\s+(.*)$/;

/**
 * 문장 종결 부호 — 이걸로 끝나는 제목 줄은 제목이 아니라 본문 문장이다.
 *
 * 물음표·느낌표는 넣지 않는다. "제출 기한은 언제인가요?" 같은 제목이 실제로 쓰이고,
 * 물음표로 끝나는 본문(시험지 문항 등)은 아래 연속 규칙이 잡아준다.
 */
const SENTENCE_END = /[.。]$/;

/** 같은 단계 제목이 이 수를 넘겨 잇달아 나오면 제목이 아니라고 본다 */
const MAX_CONSECUTIVE_HEADINGS = 2;

interface HeadingLine {
  readonly level: number;
  readonly text: string;
}

/**
 * 제목으로 잘못 승격된 줄을 본문으로 되돌립니다.
 *
 * pdf2md 는 문서에서 가장 흔한 글자 크기를 본문으로 보고 그보다 큰 줄을 제목으로
 * 삼는다. 그래서 표가 많은 문서는 표 셀 크기가 최빈값이 되어 **본문 문단과 표의 각
 * 행까지 전부 제목**이 된다. 실제로 합성 코퍼스의 표 문서에서 문서 개요가 통째로
 * 망가졌다.
 *
 * 두 가지 신호로 가려낸다.
 * - 문장 종결 부호로 끝나면 제목이 아니라 본문 문장이다.
 * - 진짜 제목은 본문에 의해 서로 떨어져 있다. 같은 단계 제목이 셋 이상 잇달아
 *   나오면 표 행이나 항목 나열이다.
 */
function demoteFalseHeadings(lines: ReadonlyArray<string>): Array<string> {
  const headings = lines.map(parseHeading);
  const demoted = new Set([
    ...findProseHeadings(headings),
    ...findConsecutiveHeadings(lines, headings),
  ]);

  return lines.map((line, index) => {
    const heading = headings[index];
    return heading && demoted.has(index) ? heading.text : line;
  });
}

/** 제목 줄이면 단계와 내용을, 아니면 null 을 돌려줍니다. */
function parseHeading(line: string): HeadingLine | null {
  const matched = HEADING_LINE.exec(line);
  if (!matched) {
    return null;
  }

  const [, marker, text] = matched;
  if (!marker || text === undefined) {
    return null;
  }

  return { level: marker.length, text };
}

/** 문장으로 끝나는 제목 줄의 인덱스를 모읍니다. */
function findProseHeadings(
  headings: ReadonlyArray<HeadingLine | null>,
): Array<number> {
  return headings.flatMap((heading, index) =>
    heading && SENTENCE_END.test(heading.text) ? [index] : [],
  );
}

/**
 * 같은 단계 제목이 잇달아 나오는 구간의 인덱스를 모읍니다.
 *
 * 빈 줄은 제목 사이의 정상적인 간격이라 연속을 끊지 않는다. 제목이 아닌 내용 줄이
 * 나오면 그 자리에서 끊는다.
 */
function findConsecutiveHeadings(
  lines: ReadonlyArray<string>,
  headings: ReadonlyArray<HeadingLine | null>,
): Array<number> {
  const found: Array<number> = [];
  let run: Array<number> = [];
  let runLevel: number | null = null;

  const flush = (): void => {
    if (run.length > MAX_CONSECUTIVE_HEADINGS) {
      found.push(...run);
    }
    run = [];
    runLevel = null;
  };

  lines.forEach((line, index) => {
    const heading = headings[index];

    if (!heading) {
      // 빈 줄은 제목 사이의 정상적인 간격이라 연속을 끊지 않는다
      if (line.trim() !== "") {
        flush();
      }
      return;
    }

    if (runLevel !== heading.level) {
      flush();
      runLevel = heading.level;
    }
    run.push(index);
  });
  flush();

  return found;
}

/**
 * 줄 끝 공백을 없애고, 앞 공백은 한 칸일 때만 없앱니다.
 *
 * pdf2md 는 문단마다 공백 한 칸을 앞에 붙이는데 이는 의미 없는 잔재다. 반면
 * 두 칸 이상은 목록 이어쓰기 같은 실제 들여쓰기라 건드리지 않는다.
 */
function trimEdges(line: string): string {
  const withoutTrailing = line.replace(/\s+$/, "");
  return withoutTrailing.startsWith(" ") && !withoutTrailing.startsWith("  ")
    ? withoutTrailing.slice(1)
    : withoutTrailing;
}
