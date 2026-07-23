import { describe, expect, it } from "vitest";
import { decodeHtml } from "../src/html/decode-html.js";

/** "한글" 의 EUC-KR 인코딩 바이트 */
const HANGUL_EUC_KR = [0xc7, 0xd1, 0xb1, 0xdb];

function eucKrDocument(): Uint8Array {
  const prefix = '<html><head><meta charset="euc-kr"></head><body>';
  const suffix = "</body></html>";
  return Uint8Array.from([
    ...new TextEncoder().encode(prefix),
    ...HANGUL_EUC_KR,
    ...new TextEncoder().encode(suffix),
  ]);
}

describe("decodeHtml", () => {
  it("기본은 UTF-8로 디코딩한다", () => {
    const bytes = new TextEncoder().encode("<p>한글 본문</p>");

    expect(decodeHtml(bytes)).toContain("한글 본문");
  });

  it("meta charset을 감지해 EUC-KR을 디코딩한다", () => {
    const result = decodeHtml(eucKrDocument());

    expect(result).toContain("한글");
  });

  it("Content-Type 헤더의 charset이 meta보다 우선한다", () => {
    const result = decodeHtml(eucKrDocument(), "text/html; charset=euc-kr");

    expect(result).toContain("한글");
  });

  it("알 수 없는 charset은 UTF-8로 폴백한다", () => {
    const bytes = new TextEncoder().encode("<p>내용</p>");

    const result = decodeHtml(bytes, "text/html; charset=invalid-charset");

    expect(result).toContain("내용");
  });
});
