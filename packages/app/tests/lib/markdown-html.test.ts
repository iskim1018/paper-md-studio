import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "../../src/lib/markdown-html";
import {
  TABLE_CHUNK_MIN_ROWS,
  TABLE_CHUNK_ROWS,
} from "../../src/lib/table-chunks";

function gfmTable(rows: number): string {
  const lines = ["| 번호 | 내용 |", "| --- | ---: |"];
  for (let r = 0; r < rows; r += 1) lines.push(`| ${r} | 값${r} |`);
  return lines.join("\n");
}

function count(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

/** 본문 셀(td) 텍스트를 순서대로 — 이어지는 빈 칸은 뺀다 */
function bodyCellTexts(html: string): Array<string> {
  return [...html.matchAll(/<td([^>]*)>(.*?)<\/td>/g)]
    .filter((m) => !m[1]?.includes("table-span-cont"))
    .map((m) => m[2] ?? "");
}

describe("renderMarkdownToHtml", () => {
  it("작은 표는 나누지 않고 그대로 낸다", () => {
    const html = renderMarkdownToHtml(gfmTable(5));
    expect(html).not.toContain("table-chunk");
    expect(count(html, /<table>/g)).toBe(1);
  });

  it("큰 표를 행 묶음으로 나누고, 머리 행은 첫 묶음에만 둔다", () => {
    const rows = TABLE_CHUNK_MIN_ROWS + 50;
    const html = renderMarkdownToHtml(gfmTable(rows));

    expect(count(html, /<div class="table-chunked">/g)).toBe(1);
    expect(count(html, /<div class="table-chunk" /g)).toBe(
      Math.ceil(rows / TABLE_CHUNK_ROWS),
    );
    expect(count(html, /<thead>/g)).toBe(1);
    expect(html.indexOf("<thead>")).toBeLessThan(html.indexOf("<tbody>"));
    expect(count(html, /<tr>/g)).toBe(rows + 1);
    // 행 순서·내용·정렬(align)이 그대로다
    expect(bodyCellTexts(html).filter((_, i) => i % 2 === 0)).toEqual(
      Array.from({ length: rows }, (_, r) => String(r)),
    );
    expect(count(html, /<td align="right">/g)).toBe(rows);
  });

  it("모든 묶음이 같은 열 폭(colgroup)과 표 폭을 쓴다", () => {
    const html = renderMarkdownToHtml(gfmTable(TABLE_CHUNK_MIN_ROWS + 1));
    const colgroups = new Set(html.match(/<colgroup>.*?<\/colgroup>/g));
    const widths = new Set(html.match(/<table style="width:\d+px">/g));
    expect(colgroups.size).toBe(1);
    expect(widths.size).toBe(1);
    expect(html).toMatch(/contain-intrinsic-size:auto \d+px auto \d+px/);
  });

  it("정화 규칙은 그대로다 — 스크립트·이벤트 속성·javascript: 링크를 지운다", () => {
    const html = renderMarkdownToHtml(
      [
        "<script>alert(1)</script>",
        '<img src="x.png" onerror="alert(1)">',
        "[링크](javascript:alert(1))",
        '<div class="table-chunk" style="color:red">사칭</div>',
      ].join("\n\n"),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    // 사용자 HTML 이 묶음 클래스·style 을 흉내 내도 정화에서 걸러진다
    expect(html).not.toContain("table-chunk");
    expect(html).not.toContain("color:red");
  });

  it("셀 안 줄바꿈(<br>)과 원본 HTML 표의 병합 속성을 남긴다", () => {
    const html = renderMarkdownToHtml(
      [
        "| 가 | 나 |",
        "| --- | --- |",
        "| 첫 줄<br>둘째 줄 | 값 |",
        "",
        '<table><tr><td rowspan="2">병합</td><td>a</td></tr><tr><td>b</td></tr></table>',
      ].join("\n"),
    );
    expect(html).toContain("첫 줄<br>둘째 줄");
    expect(html).toContain('<td rowspan="2">병합</td>');
  });

  it("묶음 경계를 넘는 원본 HTML 병합은 다음 묶음에 이어지는 칸을 둔다", () => {
    const rows = TABLE_CHUNK_MIN_ROWS + 10;
    const spanStart = TABLE_CHUNK_ROWS - 1;
    const trs = Array.from({ length: rows }, (_, r) => {
      if (r === spanStart) {
        return '<tr><td rowspan="3">병합</td><td>b</td></tr>';
      }
      if (r > spanStart && r < spanStart + 3) return "<tr><td>b</td></tr>";
      return "<tr><td>a</td><td>b</td></tr>";
    });
    const html = renderMarkdownToHtml(`<table>${trs.join("")}</table>`);

    expect(html).toContain('<td rowspan="1" class="table-span-open">병합</td>');
    expect(html).toContain(
      '<td class="table-span-cont" aria-hidden="true" rowspan="2"></td>',
    );
  });

  it("이미지 경로는 건드리지 않는다 — asset URL 변환은 화면에 붙일 때 한다", () => {
    const html = renderMarkdownToHtml("![그림](./문서_images/a.png)");
    expect(html).toContain('src="./%EB%AC%B8%EC%84%9C_images/a.png"');
  });
});

describe("renderMarkdownToHtml — 나누지 않는 표", () => {
  function rawTable(rows: number, opening = "<table>", extra = ""): string {
    const trs = Array.from({ length: rows }, () => "<tr><td>a</td></tr>");
    return `${opening}${extra}<tbody>${trs.join("")}</tbody></table>`;
  }

  it("터무니없는 colspan 이 있어도 멈추지 않고 표를 나누지 않는다", () => {
    const rows = Array.from({ length: TABLE_CHUNK_MIN_ROWS + 10 }, (_, r) =>
      r === 0
        ? '<tr><td colspan="1000000">넓음</td></tr>'
        : "<tr><td>a</td></tr>",
    );
    const started = performance.now();
    const html = renderMarkdownToHtml(`<table>${rows.join("")}</table>`);
    expect(performance.now() - started).toBeLessThan(5000);
    // 열 1000 개는 나눌 이득보다 colgroup 복제 비용이 크다 — 그대로 둔다
    expect(html).not.toContain("table-chunk");
  });

  it("tfoot·캡션이 있는 원본 HTML 표는 나누지 않는다 — 캡션 글자가 사라지면 안 된다", () => {
    const withFoot = renderMarkdownToHtml(
      rawTable(
        TABLE_CHUNK_MIN_ROWS + 10,
        "<table>",
        "<tfoot><tr><td>합계</td></tr></tfoot>",
      ),
    );
    const withCaption = renderMarkdownToHtml(
      rawTable(TABLE_CHUNK_MIN_ROWS + 10, "<table>", "<caption>제목</caption>"),
    );
    expect(withFoot).not.toContain("table-chunk");
    expect(withFoot).toContain("합계");
    expect(withCaption).not.toContain("table-chunk");
    expect(withCaption).toContain("제목");
  });

  it("표의 id 는 첫 묶음에만 남는다", () => {
    const html = renderMarkdownToHtml(
      rawTable(TABLE_CHUNK_MIN_ROWS + 10, '<table id="t">'),
    );
    expect(html).toContain("table-chunk");
    expect(count(html, /id="user-content-t"/g)).toBe(1);
  });
});
