import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { HwpxLimitError } from "../src/parsers/hwpx/package.js";
import { HwpxParser } from "../src/parsers/hwpx-parser.js";
import {
  buildHwpx,
  DEFAULT_HEADER,
  paragraph,
} from "./helpers/hwpx-fixture.js";

/**
 * HWPX(ZIP) 패키지 읽기의 상한과 오류 문구.
 *
 * fflate 의 unzipSync 는 ZIP 이 **스스로 적은** 원본 크기만큼 항목마다 버퍼를
 * 잡고, 파서가 읽지도 않는 항목까지 전부 푼다. 그래서 수백 KB 짜리 파일이
 * 수백 MB 를 요구할 수 있었다 (.hwp 경로는 rhwp 결과·ZIP 겸용 파일이 같은
 * 파서를 거친다). 압축을 풀기 전에 중앙 디렉터리의 선언 크기로 거르고, 파서가
 * 쓰는 항목(XML·그림)만 푼다.
 */

const SECTION = paragraph("<run><t>본문</t></run>");
const HPF = `<?xml version="1.0" encoding="UTF-8"?>
<package><manifest><item id="section0" href="section0.xml"/></manifest><spine><itemref idref="section0"/></spine></package>`;

/**
 * 중앙 디렉터리에 적힌 항목의 원본 크기(오프셋 +24, 4바이트 LE)를 바꾼다.
 * 실제 압축 데이터는 그대로라, "풀기 전에 선언만 보고 거르는지"를 가른다.
 */
function withDeclaredSize(
  zip: Uint8Array,
  entryName: string,
  size: number,
): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const name = strToU8(entryName);
  for (let i = 0; i + 46 <= out.length; i += 1) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    const candidate = out.subarray(i + 46, i + 46 + nameLength);
    if (
      candidate.length === name.length &&
      candidate.every((b, j) => b === name[j])
    ) {
      view.setUint32(i + 24, size, true);
      return out;
    }
  }
  throw new Error(`중앙 디렉터리에서 ${entryName}을 찾지 못했습니다`);
}

function parseBytes(data: Uint8Array) {
  return new HwpxParser().parseBytes(data, { imagesDirName: "img" });
}

describe("HWPX 패키지 상한 (#9)", () => {
  it("파서가 쓰지 않는 항목은 선언 크기가 커도 풀지 않는다", async () => {
    // Arrange — 미리보기 그림이 4GB 라고 주장하는 파일
    const zip = buildHwpx(SECTION, {
      extraFiles: { "Preview/PrvImage.png": new Uint8Array(64) },
    });
    const lying = withDeclaredSize(zip, "Preview/PrvImage.png", 0xfffffff0);

    // Act
    const result = await parseBytes(lying);

    // Assert
    expect(result.markdown).toBe("본문");
  });

  it("쓰는 항목(본문 그림)의 선언 크기가 상한을 넘으면 풀기 전에 거부한다", async () => {
    const zip = buildHwpx(SECTION, {
      extraFiles: { "BinData/image1.png": new Uint8Array(64) },
    });
    const bomb = withDeclaredSize(zip, "BinData/image1.png", 0xfffffff0);

    const error = await parseBytes(bomb).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HwpxLimitError);
    expect((error as Error).message).toMatch(
      /^HWPX 압축을 풀면 비정상적으로 커지는 데이터가 있어 변환을 중단했습니다/,
    );
  });

  it("본문 XML 합계가 XML 상한을 넘으면 거부한다", async () => {
    const zip = buildHwpx(SECTION);
    const bomb = withDeclaredSize(
      zip,
      "Contents/section0.xml",
      200 * 1024 * 1024,
    );

    await expect(parseBytes(bomb)).rejects.toThrow(/본문 XML/);
  });

  it("항목 수가 상한을 넘으면 거부한다", async () => {
    const files: Record<string, Uint8Array> = {
      "Contents/header.xml": strToU8(DEFAULT_HEADER),
      "Contents/section0.xml": strToU8(SECTION),
      "Contents/content.hpf": strToU8(HPF),
    };
    for (let i = 0; i < 10_001; i += 1) files[`junk/${i}`] = new Uint8Array(0);

    const error = await parseBytes(zipSync(files, { level: 0 })).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(HwpxLimitError);
    expect((error as Error).message).toMatch(/항목이 너무 많습니다/);
  });

  it("평범한 문서의 그림은 그대로 뽑는다", async () => {
    const zip = buildHwpx(
      paragraph('<run><pic><img binaryItemIDRef="image1"/></pic></run>'),
      { extraFiles: { "BinData/image1.png": new Uint8Array([1, 2, 3]) } },
    );

    const result = await parseBytes(zip);

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.data).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("HWPX 머리·목차 XML 오류 문구 (#18)", () => {
  const BROKEN_XML = '<head><style id="1';

  it("header.xml을 해석할 수 없으면 한국어로 알린다", async () => {
    const zip = buildHwpx(SECTION, { headerXml: BROKEN_XML });

    await expect(parseBytes(zip)).rejects.toThrow(
      /^HWPX 머리\(header\.xml\)를 해석할 수 없습니다/,
    );
  });

  it("content.hpf를 해석할 수 없으면 한국어로 알린다", async () => {
    const zip = zipSync({
      "Contents/header.xml": strToU8(DEFAULT_HEADER),
      "Contents/section0.xml": strToU8(SECTION),
      "Contents/content.hpf": strToU8(BROKEN_XML),
    });

    await expect(parseBytes(zip)).rejects.toThrow(
      /^HWPX 목차\(content\.hpf\)를 해석할 수 없습니다/,
    );
  });
});
