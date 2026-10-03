import { describe, expect, it } from "vitest";
import {
  type MdNode,
  nodesOfType,
  parseMarkdown,
  textOf,
} from "./helpers/commonmark.js";
import {
  paragraph,
  parseHwpx,
  prefixHeader,
  prefixSection,
  tableSection,
  unescapedPipeCounts,
} from "./helpers/hwpx-fixture.js";

/**
 * 변환 결과가 **렌더러에서도** 원문대로 보이는지 고정한다.
 *
 * 글자만 비교하면 통과하지만 CommonMark 렌더러(앱 미리보기·Crepe 편집기)에서는
 * 깨지는 결함들 — 목록 머리 뒤 날짜가 중첩 목록이 되고, 번호가 다시 매겨지고,
 * 본문의 `$`가 수식과 짝을 맺고, 문장부호로 시작하는 굵은 글씨가 `**` 그대로
 * 보인다. 그래서 출력 문자열을 remark(+gfm·math)로 다시 읽어 구조를 본다.
 */
const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
      <style id="3" name="나열" />
    </styles>
    <charProperties>
      <charPr id="0" />
      <charPr id="1"><bold /></charPr>
      <charPr id="2"><italic /></charPr>
      <charPr id="3"><bold /><italic /></charPr>
      <charPr id="4"><strikeout shape="SOLID" /></charPr>
    </charProperties>
    <numberings>
      <numbering id="1"><paraHead start="1" level="1" numFormat="DIGIT">^1.</paraHead></numbering>
      <numbering id="2"><paraHead start="1" level="1" numFormat="DIGIT">^1.</paraHead></numbering>
      <numbering id="3"><paraHead start="1" level="1" numFormat="DIGIT">^1)</paraHead></numbering>
      <numbering id="4"><paraHead start="1" level="1" numFormat="DIGIT">[^1](javascript:alert(1))</paraHead></numbering>
    </numberings>
    <bullets>
      <bullet id="1" char="-" useImage="0" />
      <bullet id="2" char="#" useImage="0" />
      <bullet id="3" char="|" useImage="0" />
    </bullets>
    <paraProperties>
      <paraPr id="10"><heading type="NUMBER" idRef="1" level="0" /></paraPr>
      <paraPr id="11"><heading type="NUMBER" idRef="2" level="0" /></paraPr>
      <paraPr id="12"><heading type="NUMBER" idRef="3" level="0" /></paraPr>
      <paraPr id="13"><heading type="NUMBER" idRef="4" level="0" /></paraPr>
      <paraPr id="20"><heading type="BULLET" idRef="1" level="0" /></paraPr>
      <paraPr id="21"><heading type="BULLET" idRef="2" level="0" /></paraPr>
      <paraPr id="22"><heading type="BULLET" idRef="3" level="0" /></paraPr>
    </paraProperties>
  </refList>
</head>`;

const VARIANTS: Array<[string, (s: string) => string, (h: string) => string]> =
  [
    ["접두사 없음", (s) => s, (h) => h],
    ["hp:/hh: 접두사 + xmlns", prefixSection, prefixHeader],
  ];

/** 문단 모양(paraPr)을 지정한 문단 하나 */
function p(paraPr: string, text: string): string {
  return `<p paraPrIDRef="${paraPr}" styleIDRef="0"><run><t>${text}</t></run></p>`;
}

/** 글자 모양(charPr)을 지정한 run 하나 */
function run(charPr: string, text: string): string {
  return `<run charPrIDRef="${charPr}"><t>${text}</t></run>`;
}

function equation(script: string): string {
  return `<equation><script>${script}</script></equation>`;
}

function literalDelimiters(tree: MdNode): Array<string> {
  return nodesOfType(tree, "text")
    .map((node) => node.value ?? "")
    .filter((value) => /[*~]{1,2}/.test(value));
}

describe.each(VARIANTS)("HWPX → CommonMark 렌더링 (%s)", (_l, sec, head) => {
  const md = async (body: string): Promise<string> =>
    (
      await parseHwpx(sec(`<sec>${body}</sec>`), {
        headerXml: head(HEADER),
      })
    ).markdown ?? "";
  const mdOf = async (xml: string): Promise<string> =>
    (await parseHwpx(sec(xml), { headerXml: head(HEADER) })).markdown ?? "";

  describe("문단 머리 뒤 글자의 블록 문법 (#11)", () => {
    it.each([
      ["10", "2024. 3. 1. 시행"],
      ["20", "2024. 3. 1. 개정"],
      ["10", "> 비고"],
      ["10", "1) 하위"],
      ["10", "# 제목"],
      ["10", "- 항목"],
      ["10", "+ 항목"],
      ["10", "2024."],
      ["20", "1) 하위"],
    ])("머리(paraPr %s) 뒤 '%s'는 중첩 블록이 되지 않는다", async (paraPr, text) => {
      // Act
      const tree = parseMarkdown(await md(p(paraPr, text)));

      // Assert — 목록 하나, 항목 하나, 그 안은 글자 그대로
      const lists = nodesOfType(tree, "list");
      expect(lists).toHaveLength(1);
      expect(nodesOfType(tree, "listItem")).toHaveLength(1);
      expect(nodesOfType(tree, "blockquote")).toHaveLength(0);
      expect(nodesOfType(tree, "heading")).toHaveLength(0);
      expect(textOf(lists[0] as MdNode)).toBe(text);
    });
  });

  describe("번호 목록의 번호 보존 (#17)", () => {
    function orderedStarts(tree: MdNode): Array<[number, number]> {
      return nodesOfType(tree, "list")
        .filter((list) => list.ordered)
        .map((list) => [list.start ?? 1, list.children?.length ?? 0]);
    }

    it("이어지는 번호는 그대로 하나의 목록이 된다", async () => {
      const out = await md([p("10", "a"), p("10", "b"), p("10", "c")].join(""));

      expect(out).toBe("1. a\n\n2. b\n\n3. c");
      expect(orderedStarts(parseMarkdown(out))).toEqual([[1, 3]]);
    });

    it("빈 번호 문단이 번호를 소비해 건너뛴 번호는 escape해 원본 번호를 지킨다", async () => {
      const out = await md([p("10", "a"), p("10", ""), p("10", "c")].join(""));

      expect(out).toBe("1. a\n\n3\\. c");
      const tree = parseMarkdown(out);
      expect(orderedStarts(tree)).toEqual([[1, 1]]);
      expect(textOf(tree)).toContain("3. c");
    });

    it("다른 번호 체계가 1로 다시 시작하면 escape해 '3'으로 바뀌지 않게 한다", async () => {
      const out = await md([p("10", "a"), p("10", "b"), p("11", "c")].join(""));

      expect(out).toBe("1. a\n\n2. b\n\n1\\. c");
      expect(orderedStarts(parseMarkdown(out))).toEqual([[1, 2]]);
    });

    it("')' 번호도 건너뛰면 escape한다", async () => {
      const out = await md([p("12", "a"), p("12", ""), p("12", "c")].join(""));

      expect(out).toBe("1) a\n\n3\\) c");
      expect(orderedStarts(parseMarkdown(out))).toEqual([[1, 1]]);
    });

    it("구분자가 바뀌면 렌더러도 새 목록을 시작하므로 그대로 둔다", async () => {
      const out = await md([p("10", "a"), p("12", "b")].join(""));

      expect(out).toBe("1. a\n\n1) b");
      expect(orderedStarts(parseMarkdown(out))).toEqual([
        [1, 1],
        [1, 1],
      ]);
    });

    it("일반 문단 뒤의 번호는 새 목록의 시작 번호로 그대로 보인다", async () => {
      const out = await md(
        [p("10", "a"), p("0", "사이 글"), p("10", "b")].join(""),
      );

      expect(out).toBe("1. a\n\n사이 글\n\n2. b");
      expect(orderedStarts(parseMarkdown(out))).toEqual([
        [1, 1],
        [2, 1],
      ]);
    });
  });

  describe("문서가 정한 머리 글자는 Markdown 문법이 되지 않는다 (#12)", () => {
    it("번호 형식에 링크 문법이 있어도 링크가 생기지 않는다", async () => {
      const tree = parseMarkdown(await md(p("13", "항목")));

      expect(nodesOfType(tree, "link")).toHaveLength(0);
      expect(textOf(tree)).toBe("[1](javascript:alert(1)) 항목");
    });

    it("'#' 글머리표는 제목이 되지 않는다", async () => {
      const tree = parseMarkdown(await md(p("21", "항목")));

      expect(nodesOfType(tree, "heading")).toHaveLength(0);
      expect(textOf(tree)).toBe("# 항목");
    });

    it("표 셀 안 '|' 글머리표는 열 구분자가 되지 않는다", async () => {
      const out = await mdOf(tableSection([p("22", "항목"), p("0", "옆")]));

      expect(new Set(unescapedPipeCounts(out))).toEqual(new Set([3]));
      expect(nodesOfType(parseMarkdown(out), "tableCell")).toHaveLength(2);
    });
  });

  describe("본문의 '$'와 수식 (#23)", () => {
    it("본문 '$'가 수식의 '$'와 짝을 맺지 않는다", async () => {
      // Act
      const out = await mdOf(
        paragraph(
          `<run><t>가격 US$5, </t>${equation("{1} over {2}")}<t> 끝</t></run>`,
        ),
      );

      // Assert
      const tree = parseMarkdown(out);
      const math = nodesOfType(tree, "inlineMath");
      expect(math.map((node) => node.value)).toEqual(["\\frac{1}{2}"]);
      expect(textOf(tree)).toBe("가격 US$5, \\frac{1}{2} 끝");
    });

    it("수식이 없어도 '$' 두 개가 수식으로 읽히지 않는다", async () => {
      const tree = parseMarkdown(
        await mdOf(paragraph("<run><t>US$5 와 US$10</t></run>")),
      );

      expect(nodesOfType(tree, "inlineMath")).toHaveLength(0);
      expect(textOf(tree)).toBe("US$5 와 US$10");
    });

    it("표 셀에서도 '$'와 수식이 섞여 깨지지 않는다", async () => {
      const out = await mdOf(
        tableSection([
          `<p><run><t>US$5 </t>${equation("x^2")}</run></p>`,
          "<p><run><t>옆</t></run></p>",
        ]),
      );

      const tree = parseMarkdown(out);
      expect(nodesOfType(tree, "inlineMath")).toHaveLength(1);
      expect(nodesOfType(tree, "tableCell")).toHaveLength(2);
    });
  });

  describe("문장부호로 시작·끝나는 강조 (#29)", () => {
    it.each([
      ["굵게", "1", "사업", "(SW)", "정보", "strong", "SW"],
      ["굵게 — 여는 쪽만", "1", "사업", "(SW) 개요", "", "strong", "SW) 개요"],
      ["굵게 — 닫는 쪽만", "1", "가", "SW)", "나", "strong", "SW"],
      ["굵게 — 낫표", "1", "이른바", "「제목」", "이다", "strong", "제목"],
      ["기울임", "2", "사업", "(SW)", "정보", "emphasis", "SW"],
      ["굵게+기울임", "3", "사업", "(SW)", "정보", "strong", "SW"],
      ["취소선", "4", "사업", "(SW)", "정보", "delete", "SW"],
    ])("%s: 렌더러에서 강조로 읽히고 글자는 그대로다", async (_n, charPr, before, styled, after, type, inner) => {
      // Act
      const out = await mdOf(
        paragraph(run("0", before) + run(charPr, styled) + run("0", after)),
      );

      // Assert
      const tree = parseMarkdown(out);
      const nodes = nodesOfType(tree, type);
      expect(nodes).toHaveLength(1);
      expect(textOf(nodes[0] as MdNode)).toContain(inner);
      expect(textOf(tree)).toBe(`${before}${styled}${after}`);
      expect(literalDelimiters(tree)).toEqual([]);
    });

    it("굵게+기울임은 두 강조가 모두 살아 있다", async () => {
      const tree = parseMarkdown(
        await mdOf(
          paragraph(run("0", "사업") + run("3", "(SW)") + run("0", "정보")),
        ),
      );

      expect(nodesOfType(tree, "strong")).toHaveLength(1);
      expect(nodesOfType(tree, "emphasis")).toHaveLength(1);
    });

    it("문장부호만 굵은 경우에도 '*'가 글자로 새지 않는다", async () => {
      const tree = parseMarkdown(
        await mdOf(paragraph(run("0", "가") + run("1", "()") + run("0", "나"))),
      );

      expect(textOf(tree)).toBe("가()나");
      expect(literalDelimiters(tree)).toEqual([]);
    });

    it("표 셀 안에서도 강조로 읽힌다", async () => {
      const out = await mdOf(
        tableSection([
          `<p>${run("0", "사업")}${run("1", "(SW)")}${run("0", "정보")}</p>`,
        ]),
      );

      const tree = parseMarkdown(out);
      expect(nodesOfType(tree, "strong")).toHaveLength(1);
      expect(literalDelimiters(tree)).toEqual([]);
    });

    it("셀 안 줄바꿈(<br>)이 강조 끝에 있어도 태그를 쪼개지 않는다", async () => {
      const out = await mdOf(
        tableSection([
          `<p>${run("1", "가(<lineBreak/>")}${run("0", "나")}</p>`,
        ]),
      );

      expect(out).toContain("<br>");
      const tree = parseMarkdown(out);
      expect(nodesOfType(tree, "strong")).toHaveLength(1);
      expect(literalDelimiters(tree)).toEqual([]);
    });

    it("평범한 굵은 글씨는 종전 출력 그대로다", async () => {
      const out = await mdOf(
        paragraph(run("0", "제21조와 ") + run("1", "같은")),
      );

      expect(out).toBe("제21조와 **같은**");
    });
  });
});
