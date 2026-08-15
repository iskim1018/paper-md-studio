import { describe, expect, it } from "vitest";
import {
  MERGE_LEFT,
  MERGE_UP,
  normalizeHtmlTablesToGfm,
} from "../src/parsers/html-tables-to-gfm.js";

/**
 * kordoc이 내보내는 HTML 표를 자체 HWPX 파서와 같은 계약의 GFM으로 내린다.
 *
 * GFM 표에는 셀 병합 문법이 없어 colspan/rowspan이 구조적으로 소실된다.
 * 종전 계약(빈 셀 padding)은 "진짜 빈칸"과 "병합 자리"를 구분할 수 없었다 —
 * 실물 표본에서 빈칸처럼 보이는 셀의 59%가 사실은 병합 자리였다.
 * 그래서 병합 자리에 원점 방향 화살표를 남긴다. GFM 빈 셀도 padding 공백으로
 * 이미 토큰 1개를 쓰므로 이 표기는 토큰 비용이 0이다 (2026-08-08 실측).
 *
 * 픽스처는 전부 합성 HTML이다 (비공개 문서 발췌 금지).
 */
describe("normalizeHtmlTablesToGfm", () => {
  it("표가 없으면 입력을 그대로 돌려준다", () => {
    const md = "# 제목\n\n본문 문단입니다.\n";

    expect(normalizeHtmlTablesToGfm(md)).toBe(md);
  });

  it("단순 표를 GFM으로 내린다", () => {
    const md =
      "<table><tr><th>가</th><th>나</th></tr><tr><td>1</td><td>2</td></tr></table>";

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("| 가 | 나 |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 1 | 2 |");
    expect(out).not.toContain("<table");
  });

  it("colspan 연속 자리에 왼쪽 화살표를 남긴다", () => {
    const md =
      '<table><tr><td colspan="3">병합</td></tr><tr><td>가</td><td>나</td><td>다</td></tr></table>';

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain(`| 병합 | ${MERGE_LEFT} | ${MERGE_LEFT} |`);
    expect(out).toContain("| 가 | 나 | 다 |");
  });

  it("rowspan 연속 자리에 위쪽 화살표를 남긴다", () => {
    const md =
      '<table><tr><td rowspan="2">병합</td><td>가</td></tr><tr><td>나</td></tr></table>';

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("| 병합 | 가 |");
    expect(out).toContain(`| ${MERGE_UP} | 나 |`);
  });

  it("가로·세로 동시 병합은 아래 자리를 위쪽 화살표로 채운다 — 따라가면 원점에 닿는다", () => {
    const md =
      '<table><tr><td colspan="2" rowspan="2">원점</td><td>가</td></tr><tr><td>나</td></tr></table>';

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain(`| 원점 | ${MERGE_LEFT} | 가 |`);
    expect(out).toContain(`| ${MERGE_UP} | ${MERGE_UP} | 나 |`);
  });

  it("진짜 빈 셀은 빈칸으로 남겨 병합 자리와 구분한다", () => {
    const md =
      '<table><tr><td>가</td><td></td><td colspan="2">병합</td></tr></table>';

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain(`| 가 |  | 병합 | ${MERGE_LEFT} |`);
  });

  it("행마다 셀 수가 달라도 최대 열 수로 padding 한다", () => {
    // GFM은 첫 행 separator로 열 수가 결정되어 뒤 행이 길면 잘린다.
    const md =
      "<table><tr><td>가</td></tr><tr><td>나</td><td>다</td></tr></table>";

    const out = normalizeHtmlTablesToGfm(md);
    const rows = out.split("\n").filter((l) => l.startsWith("|"));

    for (const row of rows) {
      expect(row.split("|").length).toBe(4); // "| a | b |" → ["", " a ", " b ", ""]
    }
  });

  it("셀 내부 중첩 표는 (표 R×C) 인라인으로 평탄화한다", () => {
    const md =
      "<table><tr><td>바깥<table><tr><td>속1</td><td>속2</td></tr></table></td></tr></table>";

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("(표 1×2)");
    expect(out).toContain("속1");
    expect(out).toContain("속2");
    // 부모 표가 깨지지 않아야 한다 — 중첩 표가 별도 블록으로 새어나오면 안 된다
    expect(out).not.toContain("<table");
  });

  it("셀 안 줄바꿈은 <br>로 유지해 표가 깨지지 않게 한다", () => {
    const md = "<table><tr><td>첫줄<br>둘째줄</td><td>가</td></tr></table>";

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("첫줄<br>둘째줄");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBe(2);
  });

  it("표 바깥의 마크다운은 건드리지 않는다", () => {
    const md =
      "# 제목\n\n앞 문단\n\n<table><tr><td>셀</td></tr></table>\n\n뒤 문단\n";

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("# 제목");
    expect(out).toContain("앞 문단");
    expect(out).toContain("뒤 문단");
    expect(out).toContain("| 셀 |");
  });

  it("표가 여러 개면 각각 변환한다", () => {
    const md =
      "<table><tr><td>첫째</td></tr></table>\n\n사이 문단\n\n<table><tr><td>둘째</td></tr></table>";

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("| 첫째 |");
    expect(out).toContain("| 둘째 |");
    expect(out).toContain("사이 문단");
    expect(out).not.toContain("<table");
  });

  it("셀 안의 파이프 문자는 escape 해 표를 깨뜨리지 않는다", () => {
    const md = "<table><tr><td>가|나</td><td>다</td></tr></table>";

    const out = normalizeHtmlTablesToGfm(md);
    const row = out.split("\n").find((l) => l.includes("가"));

    // 백슬래시 하나로만 escape 돼야 한다. HTML 단계에서 미리 "\|"로 바꾸면
    // turndown이 백슬래시를 한 번 더 escape해 "\\|"가 되고 표가 깨진다.
    expect(row).toContain("가\\|나");
    expect(row).not.toContain("\\\\|");
    // 컬럼 수는 escape 되지 않은 파이프로만 센다
    expect(row?.split(/(?<!\\)\|/).length).toBe(4);
  });

  it("셀 안의 이미지를 보존한다 — 텍스트만 뽑으면 사라진다", () => {
    const md =
      '<table><tr><td>글자<img src="./doc_images/img_001.png" alt="그림"></td><td>다</td></tr></table>';

    const out = normalizeHtmlTablesToGfm(md);

    expect(out).toContain("![그림](./doc_images/img_001.png)");
    expect(out).toContain("글자");
  });

  // mammoth(DOCX)는 셀 내용을 <p>로 감싼다. 블록 요소가 셀에 남으면 turndown이
  // 줄바꿈을 내어 GFM 표가 여러 줄로 조각난다 (1행=1줄이어야 렌더된다).
  describe("셀 안 블록 요소 평탄화 (DOCX/mammoth 계약)", () => {
    it("셀 안 문단 여러 개를 <br>로 이어 한 줄로 만든다", () => {
      const md =
        "<table><tr><td><p>첫 문단</p><p>둘째 문단</p></td><td><p>가</p></td></tr></table>";

      const out = normalizeHtmlTablesToGfm(md);
      const rows = out.split("\n").filter((l) => l.startsWith("|"));

      expect(out).toContain("첫 문단<br>둘째 문단");
      expect(out).toContain("| 가 |");
      expect(rows).toHaveLength(2); // 헤더 + separator
    });

    it("문단 하나짜리 셀에는 <br>를 남기지 않는다", () => {
      const md = "<table><tr><td><p>혼자</p></td></tr></table>";

      const out = normalizeHtmlTablesToGfm(md);

      expect(out).toContain("| 혼자 |");
      expect(out).not.toContain("<br>");
    });

    it("셀 안 목록은 항목을 <br>로 이어 평탄화한다", () => {
      const md =
        "<table><tr><td><ul><li>하나</li><li>둘</li></ul></td></tr></table>";

      const out = normalizeHtmlTablesToGfm(md);

      expect(out).toContain("하나<br>둘");
      expect(out.split("\n").filter((l) => l.startsWith("|"))).toHaveLength(2);
    });

    it("셀 안 문단의 강조 마크업은 살린다", () => {
      const md =
        "<table><tr><td><p><strong>굵게</strong></p><p>보통</p></td></tr></table>";

      const out = normalizeHtmlTablesToGfm(md);

      expect(out).toContain("**굵게**<br>보통");
    });
  });
});
