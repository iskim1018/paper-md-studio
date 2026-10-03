import { describe, expect, it } from "vitest";
import { detectHwpFormat } from "../src/parsers/hwp/detect.js";

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function bytes(...parts: Array<string | Array<number>>): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === "string"
      ? new Uint8Array(Buffer.from(part, "latin1"))
      : new Uint8Array(part),
  );
  return new Uint8Array(Buffer.concat(chunks));
}

function utf16le(text: string, withBom: boolean): Uint8Array {
  const body = Buffer.from(text, "utf16le");
  return new Uint8Array(
    withBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body,
  );
}

function utf16be(text: string, withBom: boolean): Uint8Array {
  const le = Buffer.from(text, "utf16le");
  const be = Buffer.from(le);
  be.swap16();
  return new Uint8Array(
    withBom ? Buffer.concat([Buffer.from([0xfe, 0xff]), be]) : be,
  );
}

const HWPML = `<?xml version="1.0" encoding="UTF-8"?>\n<HWPML Version="2.91"><HEAD/></HWPML>`;

describe("detectHwpFormat", () => {
  it("0바이트면 empty", () => {
    expect(detectHwpFormat(new Uint8Array(0))).toBe("empty");
  });

  it("OLE2 매직 8바이트가 모두 맞아야 hwp5", () => {
    // Arrange
    const ole2 = bytes(OLE2_MAGIC, new Array(504).fill(0));
    const fourBytesOnly = bytes(OLE2_MAGIC.slice(0, 4), [0, 0, 0, 0]);

    // Act / Assert
    expect(detectHwpFormat(ole2)).toBe("hwp5");
    expect(detectHwpFormat(fourBytesOnly)).toBe("unknown");
  });

  it("HWP 3.0 시그니처는 hwp3", () => {
    const hwp3 = bytes("HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05");

    expect(detectHwpFormat(hwp3)).toBe("hwp3");
  });

  it("V3.00 이 아닌 옛 시그니처는 hwp-legacy", () => {
    for (const version of ["V2.00", "V3.01", "V3.10", "V1.20"]) {
      expect(detectHwpFormat(bytes(`HWP Document File ${version} `))).toBe(
        "hwp-legacy",
      );
    }
  });

  it("ZIP 로컬 헤더는 zip (HWPX 를 .hwp 로 저장한 경우)", () => {
    expect(detectHwpFormat(bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0]))).toBe(
      "zip",
    );
  });

  it("XML 선언이 있는 UTF-8 HWPML", () => {
    expect(detectHwpFormat(bytes(HWPML))).toBe("hwpml");
  });

  it("UTF-8 BOM·선언 없음·DOCTYPE·주석이 앞에 와도 HWPML 로 본다", () => {
    const withBom = new Uint8Array(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(HWPML)]),
    );
    const noDecl = new Uint8Array(Buffer.from(`\n  <HWPML Version="2.91">`));
    const doctype = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?>\n<!-- 주석 -->\n<!DOCTYPE HWPML [ <!ENTITY a "b"> ]>\n<HWPML>`,
      ),
    );

    expect(detectHwpFormat(withBom)).toBe("hwpml");
    expect(detectHwpFormat(noDecl)).toBe("hwpml");
    expect(detectHwpFormat(doctype)).toBe("hwpml");
  });

  it("UTF-16 LE/BE HWPML 을 BOM 유무와 관계없이 판별한다", () => {
    expect(detectHwpFormat(utf16le(HWPML, true))).toBe("hwpml");
    expect(detectHwpFormat(utf16le(HWPML, false))).toBe("hwpml");
    expect(detectHwpFormat(utf16be(HWPML, true))).toBe("hwpml");
    expect(detectHwpFormat(utf16be(HWPML, false))).toBe("hwpml");
  });

  it("루트가 HWPML 이 아닌 XML 이나 HWPML 로 시작하는 다른 태그는 unknown", () => {
    expect(detectHwpFormat(bytes(`<?xml version="1.0"?><html/>`))).toBe(
      "unknown",
    );
    expect(detectHwpFormat(bytes(`<HWPMLX Version="2.91">`))).toBe("unknown");
    expect(detectHwpFormat(bytes(`텍스트 <HWPML Version="2.91">`))).toBe(
      "unknown",
    );
  });

  it("PDF·일반 텍스트·임의 바이트는 unknown", () => {
    expect(detectHwpFormat(bytes("%PDF-1.7\n"))).toBe("unknown");
    expect(detectHwpFormat(bytes("그냥 텍스트"))).toBe("unknown");
    expect(detectHwpFormat(bytes([0x00, 0x01, 0x02, 0x03]))).toBe("unknown");
  });

  it("DOCTYPE 이 길어 루트가 4KB 근처에 있어도 판별한다", () => {
    const comment = `<!-- ${"x".repeat(3500)} -->`;
    const text = `<?xml version="1.0"?>${comment}<HWPML Version="2.91">`;

    expect(detectHwpFormat(bytes(text))).toBe("hwpml");
  });
});
