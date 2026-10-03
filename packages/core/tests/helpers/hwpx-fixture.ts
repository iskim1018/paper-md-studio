import { strToU8, zipSync } from "fflate";
import { HwpxParser } from "../../src/parsers/hwpx-parser.js";
import type { ParseResult } from "../../src/types.js";

/**
 * 테스트용 최소 HWPX 생성기.
 *
 * 실제 한컴·rhwp 산출물은 모든 요소에 `hs:`/`hp:`/`hh:` 접두사와 xmlns 선언을
 * 단다. 접두사가 없는 픽스처만 쓰면 접두사 처리(removeNSPrefix·stopNodes)가
 * 깨져도 테스트가 통과하므로, `prefixSection`·`prefixHeader`로 같은 XML을
 * 실물 모양으로 바꿔 두 변형을 함께 검증한다.
 */

const NS_SECTION = "http://www.hancom.co.kr/hwpml/2011/section";
const NS_PARAGRAPH = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const NS_HEAD = "http://www.hancom.co.kr/hwpml/2011/head";

export const DEFAULT_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
      <style id="1" name="1. 제목" />
      <style id="2" name="1.1 부제목" />
      <style id="3" name="나열" />
    </styles>
    <charProperties>
      <charPr id="0" />
      <charPr id="1"><bold /></charPr>
    </charProperties>
  </refList>
</head>`;

const HPF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<package>
  <manifest>
    <item id="section0" href="section0.xml" />
  </manifest>
  <spine>
    <itemref idref="section0" />
  </spine>
</package>`;

export interface HwpxFixtureOptions {
  readonly headerXml?: string;
  readonly extraFiles?: Record<string, Uint8Array>;
}

export function buildHwpx(
  sectionXml: string,
  opts?: HwpxFixtureOptions,
): Uint8Array {
  return zipSync({
    mimetype: strToU8("application/hwpx+zip"),
    "Contents/header.xml": strToU8(opts?.headerXml ?? DEFAULT_HEADER),
    "Contents/section0.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n${sectionXml}`,
    ),
    "Contents/content.hpf": strToU8(HPF_XML),
    ...opts?.extraFiles,
  });
}

function prefixTags(xml: string, prefixOf: (name: string) => string): string {
  return xml.replace(
    /<(\/?)([A-Za-z]\w*)/g,
    (_match, slash: string, name: string) =>
      `<${slash}${prefixOf(name)}:${name}`,
  );
}

/** 섹션 XML을 실물처럼 `hs:sec` + `hp:*` 접두사와 xmlns 선언이 붙은 형태로 바꾼다 */
export function prefixSection(xml: string): string {
  return prefixTags(xml, (name) => (name === "sec" ? "hs" : "hp")).replace(
    "<hs:sec",
    `<hs:sec xmlns:hs="${NS_SECTION}" xmlns:hp="${NS_PARAGRAPH}"`,
  );
}

/** header.xml을 실물처럼 `hh:*` 접두사와 xmlns 선언이 붙은 형태로 바꾼다 */
export function prefixHeader(xml: string): string {
  return prefixTags(xml, () => "hh").replace(
    "<hh:head",
    `<hh:head xmlns:hh="${NS_HEAD}"`,
  );
}

/** 파일을 쓰지 않고 바이트로 바로 파싱한다 */
export function parseHwpx(
  sectionXml: string,
  opts?: HwpxFixtureOptions,
): Promise<ParseResult> {
  return new HwpxParser().parseBytes(buildHwpx(sectionXml, opts), {
    imagesDirName: "doc_images",
  });
}

/** 본문 문단 하나짜리 섹션 — 대부분의 인라인 테스트가 이 모양이다 */
export function paragraph(runs: string, attrs = 'styleIDRef="0"'): string {
  return `<sec><p ${attrs}>${runs}</p></sec>`;
}

/** 1×N 표 하나를 담은 섹션 — 셀 내용은 `<p>` 목록 그대로 넣는다 */
export function tableSection(cells: ReadonlyArray<string>): string {
  const tcs = cells.map((c) => `<tc><subList>${c}</subList></tc>`).join("");
  return `<sec><p styleIDRef="0"><run><tbl><tr>${tcs}</tr></tbl></run></p></sec>`;
}

/** 마크다운 GFM 표의 데이터 행마다 escape되지 않은 "|" 개수를 센다 */
export function unescapedPipeCounts(markdown: string): Array<number> {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) => (line.match(/(?<!\\)\|/g) ?? []).length);
}
