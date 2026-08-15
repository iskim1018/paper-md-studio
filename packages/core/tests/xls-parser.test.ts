import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MERGE_LEFT, MERGE_UP } from "../src/parsers/html-tables-to-gfm.js";
import { convert, convertToHtml } from "../src/pipeline.js";
import type { XlsBuildOptions, XlsSheetSpec } from "./helpers/biff-writer.js";
import { buildXls } from "./helpers/biff-writer.js";

/**
 * XLS(BIFF8) 자체 파서 계약 테스트.
 *
 * 사용자에게 .xls와 .xlsx는 "같은 엑셀"이다. 확장자만 다른 같은 표가 다르게
 * 변환되면 버그로 보이므로, 격자 이후 단계를 공유하는지까지 확인한다.
 *
 * 픽스처는 합성 BIFF8이다 (비공개 문서 발췌 금지). 생성기가 만든 바이트가
 * 진짜 BIFF8인지는 독립 구현(kordoc)이 읽어내는 것으로 확인했다.
 */
describe("XLS 변환", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "xls-parser-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function convertXls(
    fileName: string,
    sheets: ReadonlyArray<XlsSheetSpec>,
    options?: XlsBuildOptions,
    includeHidden = false,
  ) {
    const path = join(tmpDir, `${fileName}.xls`);
    await writeFile(path, buildXls(sheets, options));
    return convert({
      inputPath: path,
      ...(includeHidden ? { xlsx: { includeHidden: true } } : {}),
    });
  }

  it("문자열·숫자 셀을 GFM 표로 변환한다", async () => {
    const { markdown, format } = await convertXls("기본", [
      {
        name: "재고",
        rows: [
          ["품목", "수량"],
          ["연필", 100],
        ],
      },
    ]);

    expect(format).toBe("xls");
    expect(markdown).toContain("## 재고");
    expect(markdown).toContain("| 품목 | 수량 |");
    expect(markdown).toContain("| 연필 | 100 |");
  });

  it("한글 문자열을 온전히 읽는다 — BIFF8 유니코드 플래그 처리", async () => {
    const { markdown } = await convertXls("한글", [
      {
        name: "한글시트",
        rows: [
          ["품목", "비고"],
          ["연필", "재고 많음"],
        ],
      },
    ]);

    expect(markdown).toContain("## 한글시트");
    expect(markdown).toContain("재고 많음");
  });

  it("시트마다 제목을 붙인다", async () => {
    const { markdown } = await convertXls("다중시트", [
      { name: "1월", rows: [["매출", 100]] },
      { name: "2월", rows: [["매출", 200]] },
    ]);

    expect(markdown).toContain("## 1월");
    expect(markdown).toContain("## 2월");
  });

  describe("표시형식 — XLSX와 같은 규칙", () => {
    // xf 인덱스 16=날짜(14), 17=통화(사용자 164), 18=백분율(9)
    const formatOptions: XlsBuildOptions = {
      formats: [{ id: 164, code: '"₩"#,##0' }],
      xfs: [14, 164, 9],
    };

    it("날짜 시리얼을 사람이 읽는 날짜로 되돌린다", async () => {
      const { markdown } = await convertXls(
        "날짜",
        [
          {
            name: "계약",
            rows: [
              ["항목", "체결일"],
              ["A", { v: 45000, xf: 16 }],
            ],
          },
        ],
        formatOptions,
      );

      expect(markdown).toContain("2023-03-15");
      expect(markdown).not.toContain("45000");
    });

    it("통화·백분율 서식을 살린다", async () => {
      const { markdown } = await convertXls(
        "서식",
        [
          {
            name: "금액",
            rows: [
              ["금액", "비율"],
              [
                { v: 1234567, xf: 17 },
                { v: 0.157, xf: 18 },
              ],
            ],
          },
        ],
        formatOptions,
      );

      expect(markdown).toContain("₩1,234,567");
      expect(markdown).toContain("16%");
    });
  });

  describe("병합 — XLSX와 같은 화살표 표기", () => {
    it("가로 병합에 왼쪽 화살표를 남긴다", async () => {
      const { markdown } = await convertXls("가로병합", [
        {
          name: "실적",
          rows: [
            ["분기별 실적", null, null],
            ["1분기", "2분기", "3분기"],
          ],
          merges: [{ r1: 0, r2: 0, c1: 0, c2: 2 }],
        },
      ]);

      expect(markdown).toContain(
        `| 분기별 실적 | ${MERGE_LEFT} | ${MERGE_LEFT} |`,
      );
    });

    it("세로 병합에 위쪽 화살표를 남긴다", async () => {
      const { markdown } = await convertXls("세로병합", [
        {
          name: "구분",
          rows: [
            ["구분", "값"],
            [null, "둘째"],
          ],
          merges: [{ r1: 0, r2: 1, c1: 0, c2: 0 }],
        },
      ]);

      expect(markdown).toContain(`| ${MERGE_UP} | 둘째 |`);
    });
  });

  describe("숨김 처리 — XLSX와 같은 기본값·경고", () => {
    const sheets: ReadonlyArray<XlsSheetSpec> = [
      {
        name: "공개",
        rows: [
          ["항목", "숨긴열"],
          ["보임", "메모"],
          ["숨긴행", "x"],
        ],
        hiddenRows: [2],
        hiddenCols: [1],
      },
      { name: "내부검토", hidden: true, rows: [["비밀", 42]] },
    ];

    it("기본은 제외하고 무엇이 빠졌는지 알린다", async () => {
      const result = await convertXls("숨김제외", sheets);

      expect(result.markdown).not.toContain("숨긴열");
      expect(result.markdown).not.toContain("숨긴행");
      expect(result.markdown).not.toContain("내부검토");
      expect(result.hiddenExcluded).toEqual({ sheets: 1, rows: 1, cols: 1 });
    });

    it("includeHidden이면 모두 포함한다", async () => {
      const result = await convertXls("숨김포함", sheets, undefined, true);

      expect(result.markdown).toContain("숨긴열");
      expect(result.markdown).toContain("숨긴행");
      expect(result.markdown).toContain("## 내부검토");
      expect(result.hiddenExcluded).toBeUndefined();
    });

    it("뷰어용 HTML에 숨김 표시를 남긴다", async () => {
      const path = join(tmpDir, "표시.xls");
      await writeFile(path, buildXls(sheets));

      const { html } = await convertToHtml({
        inputPath: path,
        xlsx: { includeHidden: true },
      });

      expect(html).toContain('class="xlsx-hidden-row"');
      expect(html).toContain('class="xlsx-hidden-col"');
    });
  });

  it("1904 날짜 체계(구 맥 엑셀)를 반영한다", async () => {
    const { markdown } = await convertXls(
      "맥날짜",
      [{ name: "날짜", rows: [["기준일"], [{ v: 0, xf: 16 }]] }],
      { date1904: true, xfs: [14] },
    );

    expect(markdown).toContain("1904-01-01");
  });

  it("BIFF8이 아니면 사용자가 할 수 있는 일을 알려준다", async () => {
    // BIFF5(0x0500) — Excel 5/95 형식은 레코드 구조가 달라 읽지 않는다
    const path = join(tmpDir, "구버전.xls");
    await writeFile(
      path,
      buildXls([{ name: "S", rows: [["a"]] }], { biffVersion: 0x0500 }),
    );

    await expect(convert({ inputPath: path })).rejects.toThrow(
      /지원하지 않는 XLS 판/,
    );
  });
});
