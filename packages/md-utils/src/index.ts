/**
 * Markdown 후처리 유틸 — 에디터에서 사용자가 명시적으로 호출한다.
 */

/**
 * GFM 파이프 테이블에서 내용이 빈 row를 제거한다.
 *
 * - 테이블 블록 = 연속된 "|" 시작 라인의 덩어리
 * - 헤더 구분선(`| --- | --- |`)은 제외
 * - 구분선 바로 앞의 row는 헤더이므로 비어있어도 보존 (테이블 구조 유지)
 * - 모든 셀이 공백/빈 문자열 또는 Markdown 이스케이프만 있으면 빈 row로 간주
 * - 코드 펜스(```) 내부는 건드리지 않는다
 */
export function removeEmptyTableRows(markdown: string): string {
  const lines = markdown.split("\n");
  const out: Array<string> = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // 코드 펜스 진입/종료 추적
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (isTableRow(line) && !isSeparatorRow(line) && isEmptyRow(line)) {
      // 다음 non-empty 라인이 구분선이면 이 row는 헤더 → 보존
      const nextLine = lines[i + 1];
      if (nextLine !== undefined && isSeparatorRow(nextLine)) {
        out.push(line);
        continue;
      }
      continue; // 빈 body row 제거
    }
    out.push(line);
  }

  return out.join("\n");
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  // | --- | :---: | ---: | 류의 GFM 구분선
  const cells = splitCells(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function isEmptyRow(line: string): boolean {
  const cells = splitCells(line);
  if (cells.length === 0) return false;
  return cells.every((c) => stripMarkdownDecoration(c).trim() === "");
}

function splitCells(line: string): Array<string> {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  // 앞뒤 파이프 제거 후 split (이스케이프된 \| 는 고려하지 않음 — 드문 케이스)
  return trimmed.slice(1, -1).split("|");
}

function stripMarkdownDecoration(cell: string): string {
  // 빈 셀 감지 시 강조/공백 마크업은 의미 없으므로 제거
  return cell
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "");
}
