import { describe, expect, it } from "vitest";
import {
  decodeHwpml,
  HWPML_FALLBACK_VERSION,
  HWPML_VERSION_REJECTION,
  isHwpmlRoot,
  readHwpmlVersion,
  rewriteHwpmlVersion,
  sniffXmlEncoding,
} from "../src/index";

const DOC = `<?xml version="1.0"?>\n<HWPML Version="2.8" Style="embed"><HEAD/><BODY>본문</BODY></HWPML>`;

function withBom(bom: Array<number>, body: Uint8Array): Uint8Array {
  return new Uint8Array(Buffer.concat([Buffer.from(bom), body]));
}

function utf16le(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf16le"));
}

function utf16be(text: string): Uint8Array {
  const be = Buffer.from(text, "utf16le");
  be.swap16();
  return new Uint8Array(be);
}

describe("sniffXmlEncoding", () => {
  it("BOM 과 0 바이트 위치로 인코딩을 가린다", () => {
    const utf8 = new TextEncoder().encode(DOC);

    expect(sniffXmlEncoding(utf8)).toEqual({ encoding: "utf-8", bomLength: 0 });
    expect(sniffXmlEncoding(withBom([0xef, 0xbb, 0xbf], utf8))).toEqual({
      encoding: "utf-8",
      bomLength: 3,
    });
    expect(sniffXmlEncoding(withBom([0xff, 0xfe], utf16le(DOC)))).toEqual({
      encoding: "utf-16le",
      bomLength: 2,
    });
    expect(sniffXmlEncoding(utf16be(DOC))).toEqual({
      encoding: "utf-16be",
      bomLength: 0,
    });
  });
});

describe("readHwpmlVersion", () => {
  it("루트의 Version 속성(작은따옴표 포함)을 읽고, 없으면 undefined", () => {
    expect(readHwpmlVersion(DOC)).toBe("2.8");
    expect(readHwpmlVersion(`<HWPML Version='2.91'><HEAD/>`)).toBe("2.91");
    expect(readHwpmlVersion(`<HWPML Style="embed"><HEAD/>`)).toBeUndefined();
    expect(readHwpmlVersion(`<html/>`)).toBeUndefined();
  });
});

describe("rewriteHwpmlVersion", () => {
  it("UTF-8 문서의 버전만 바꾸고 나머지는 그대로 둔다", () => {
    const out = rewriteHwpmlVersion(new TextEncoder().encode(DOC), "2.91");

    expect(new TextDecoder().decode(out ?? new Uint8Array())).toBe(
      DOC.replace('Version="2.8"', 'Version="2.91"'),
    );
  });

  it("Version 속성이 없으면 루트에 넣는다", () => {
    const doc = `<HWPML Style="embed"><HEAD/></HWPML>`;

    const out = rewriteHwpmlVersion(new TextEncoder().encode(doc), "2.91");

    expect(new TextDecoder().decode(out ?? new Uint8Array())).toBe(
      `<HWPML Version="2.91" Style="embed"><HEAD/></HWPML>`,
    );
  });

  it("원래 인코딩과 BOM 을 지킨다 (UTF-8 BOM·UTF-16LE·UTF-16BE)", () => {
    const expected = DOC.replace('Version="2.8"', 'Version="2.91"');
    const inputs: Array<[Uint8Array, Uint8Array]> = [
      [
        withBom([0xef, 0xbb, 0xbf], new TextEncoder().encode(DOC)),
        withBom([0xef, 0xbb, 0xbf], new TextEncoder().encode(expected)),
      ],
      [
        withBom([0xff, 0xfe], utf16le(DOC)),
        withBom([0xff, 0xfe], utf16le(expected)),
      ],
      [
        withBom([0xfe, 0xff], utf16be(DOC)),
        withBom([0xfe, 0xff], utf16be(expected)),
      ],
      [utf16le(DOC), utf16le(expected)],
    ];

    for (const [input, want] of inputs) {
      expect(rewriteHwpmlVersion(input, "2.91")).toEqual(want);
    }
  });

  it("HEAD 가 없거나 루트가 HWPML 이 아니면 null", () => {
    const noHead = new TextEncoder().encode(`<HWPML Version="2.8"><BODY/>`);
    const notHwpml = new TextEncoder().encode(`<html><HEAD/></html>`);

    expect(rewriteHwpmlVersion(noHead, "2.91")).toBeNull();
    expect(rewriteHwpmlVersion(notHwpml, "2.91")).toBeNull();
  });
});

describe("decodeHwpml", () => {
  it("UTF-16BE 도 런타임 ICU 없이 디코드한다", () => {
    expect(decodeHwpml(withBom([0xfe, 0xff], utf16be(DOC)))).toBe(DOC);
  });
});

describe("isHwpmlRoot", () => {
  it("선언·주석·DOCTYPE 뒤 첫 요소가 HWPML 이면 true", () => {
    expect(isHwpmlRoot(DOC)).toBe(true);
    expect(isHwpmlRoot(`<!DOCTYPE x [<!ENTITY a "b">]><!-- c --><HWPML>`)).toBe(
      true,
    );
    expect(isHwpmlRoot(`<html><HWPML/></html>`)).toBe(false);
  });
});

describe("HWPML 버전 대체 (core 변환·앱 미리보기 공용)", () => {
  it("rhwp 가 받는 버전(2.91)으로 대체한다", () => {
    expect(HWPML_FALLBACK_VERSION).toBe("2.91");
  });

  it("rhwp 의 버전 거부 문구에서 원래 버전을 꺼낸다", () => {
    const raw =
      "유효하지 않은 파일: HML 오류: 지원하지 않는 HWPML 버전입니다: 2.8";

    expect(HWPML_VERSION_REJECTION.exec(raw)?.[1]).toBe("2.8");
    expect(HWPML_VERSION_REJECTION.test("CFB 오류: 스트림 없음")).toBe(false);
  });
});
