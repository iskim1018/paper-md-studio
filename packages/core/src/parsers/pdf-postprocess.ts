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
 * - 줄 끝 공백 제거
 * - pdf2md 가 문단마다 붙이는 앞 공백 한 칸 제거 (의미 있는 들여쓰기는 보존)
 */
export function cleanupPdfMarkdown(markdown: string): string {
  const lines = markdown.split("\n").map(trimEdges);
  const entries = lines.map(parseTocEntry);
  const depthByLevel = rankHeadingLevels(entries);

  return lines
    .map((line, index) => {
      const entry = entries[index];
      return entry ? renderTocEntry(entry, depthByLevel) : line;
    })
    .join("\n");
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
