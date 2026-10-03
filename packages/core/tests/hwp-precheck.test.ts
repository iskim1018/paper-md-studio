import { deflateRawSync, deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptDistributionStream } from "../src/parsers/hwp/distribution.js";
import { measureInflatedSize } from "../src/parsers/hwp/inflate-guard.js";
import {
  MAX_RECORD_INFLATED_BYTES,
  MAX_STREAM_INFLATED_BYTES,
  MAX_TOTAL_INFLATED_BYTES,
  precheckHwp3,
  precheckHwp5,
} from "../src/parsers/hwp/precheck.js";
import {
  appendDuplicateStream,
  buildCfb,
  buildHwp3,
  createEncryptedHwp5,
  createHwp5,
  deflateBomb,
  encryptViewText,
  HWP5_FLAG,
  moveHwp5Stream,
  patchHwp5Flags,
  replaceHwp5Stream,
  toDistributionDocument,
  zlibWrappedBomb,
} from "./helpers/hwp-fixtures.js";
import {
  buildOle2,
  ENDOFCHAIN,
  FATSECT,
  rootEntry,
} from "./helpers/ole2-builder.js";

const MIB = 1024 * 1024;

let plain: Uint8Array;

beforeAll(async () => {
  plain = await createHwp5("사전 검사 본문");
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return (err as { code?: string }).code;
  }
}

describe("상한 값", () => {
  it("실물 최대치(스트림 34.5MB·합계 127.7MB·본문 레코드 0.9MB) 대비 여유가 있다", () => {
    expect(MAX_STREAM_INFLATED_BYTES).toBe(100 * MIB);
    expect(MAX_RECORD_INFLATED_BYTES).toBe(64 * MIB);
    expect(MAX_TOTAL_INFLATED_BYTES).toBe(512 * MIB);
  });
});

describe("precheckHwp5 — 컨테이너·헤더", () => {
  it("평범한 문서는 통과하고 경고가 없다", () => {
    expect(precheckHwp5(plain)).toEqual([]);
  });

  it("OLE2 매직 뒤가 엉망이면 손상", () => {
    const broken = new Uint8Array(1024);
    broken.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    expect(codeOf(() => precheckHwp5(broken))).toBe("CORRUPTED");
  });

  it("FileHeader 없이 Workbook 만 있으면 확장자만 바뀐 엑셀이라고 알려준다", () => {
    const xls = buildCfb({ Workbook: new Uint8Array(64) });
    const book = buildCfb({ Book: new Uint8Array(64) });

    expect(codeOf(() => precheckHwp5(xls))).toBe("XLS_MISNAMED");
    expect(codeOf(() => precheckHwp5(book))).toBe("XLS_MISNAMED");
  });

  it("FileHeader 도 Workbook 도 없으면 손상", () => {
    const other = buildCfb({ Something: new Uint8Array(64) });

    expect(codeOf(() => precheckHwp5(other))).toBe("CORRUPTED");
  });

  it("대소문자만 다른 같은 경로의 스트림이 둘이면 손상 — 엔진이 검사 안 한 쪽을 읽을 수 있다", () => {
    const duplicated = appendDuplicateStream(
      plain,
      "BodyText/Section0",
      "SECTION0",
      deflateBomb(1),
    );

    expect(codeOf(() => precheckHwp5(duplicated))).toBe("CORRUPTED");
  });

  it("FileHeader 시그니처가 다르면 손상", () => {
    const header = new Uint8Array(256);
    header.set(new TextEncoder().encode("NOT A HWP HEADER!"));
    const patched = replaceHwp5Stream(plain, "/FileHeader", header);

    expect(codeOf(() => precheckHwp5(patched))).toBe("CORRUPTED");
  });

  it("적대적 OLE2(FAT 순환)는 CFB.read 전에 손상으로 거부한다", () => {
    // 섹터 2→3→4→3 순환을 가리키는 항목 — cfb 라면 잡을 수 없는 OOM 으로 죽는다
    const hostile = buildOle2({
      sectorCount: 5,
      fatSectors: [0],
      fat: [FATSECT, ENDOFCHAIN, 3, 4, 3],
      dirStart: 1,
      entries: [rootEntry(1), { name: "S", type: 2, start: 3, size: 8192 }],
    });
    const start = performance.now();
    expect(codeOf(() => precheckHwp5(hostile))).toBe("CORRUPTED");
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("precheckHwp5 — 속성 플래그", () => {
  it("암호(0x02)·인증서 암호(0x100)는 ENCRYPTED", () => {
    for (const flag of [HWP5_FLAG.encrypted, HWP5_FLAG.certEncrypted]) {
      expect(codeOf(() => precheckHwp5(patchHwp5Flags(plain, flag)))).toBe(
        "ENCRYPTED",
      );
    }
  });

  it("실제 암호 문서(exportHwpWithPassword)도 ENCRYPTED", async () => {
    const encrypted = await createEncryptedHwp5("비밀", "pw");

    expect(codeOf(() => precheckHwp5(encrypted))).toBe("ENCRYPTED");
  });

  it("DRM(0x10)·인증서 DRM(0x400)은 DRM_PROTECTED — rhwp 는 이 비트를 무시한다", () => {
    for (const flag of [HWP5_FLAG.drm, HWP5_FLAG.certDrm]) {
      expect(codeOf(() => precheckHwp5(patchHwp5Flags(plain, flag)))).toBe(
        "DRM_PROTECTED",
      );
    }
  });

  it("배포용(0x04)은 막지 않는다 — rhwp 가 ViewText 를 복호화한다", () => {
    expect(precheckHwp5(toDistributionDocument(plain))).toEqual([]);
  });

  it("변경 추적(0x4000)은 통과시키되 경고한다", () => {
    const tracked = patchHwp5Flags(plain, HWP5_FLAG.trackChanges);

    expect(precheckHwp5(tracked)).toEqual([
      "변경 추적이 켜진 문서입니다. 삭제 표시된 내용이 본문에 섞여 나올 수 있습니다.",
    ]);
  });
});

describe("precheckHwp5 — 압축 폭탄", () => {
  it("본문 스트림 폭탄(256MB)을 rhwp 에 넘기기 전에 빠르게 거부한다", () => {
    // Arrange — 260KB 파일이 256MB 로 풀린다. rhwp 는 이 입력에 RSS 3GB 를 잡는다
    const bomb = replaceHwp5Stream(
      plain,
      "/BodyText/Section0",
      deflateBomb(256),
    );
    const rssBefore = process.memoryUsage().rss;
    const start = performance.now();

    // Act
    const code = codeOf(() => precheckHwp5(bomb));

    // Assert
    expect(code).toBe("TOO_LARGE");
    expect(performance.now() - start).toBeLessThan(2000);
    expect(process.memoryUsage().rss - rssBefore).toBeLessThan(400 * MIB);
  });

  it("zlib 헤더로 감싼 폭탄도 잡는다", () => {
    const bomb = replaceHwp5Stream(
      plain,
      "/BodyText/Section0",
      zlibWrappedBomb(256),
    );

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it.each([
    9, 10, 11, 12, 13, 14,
  ])("창 크기가 작은 zlib 헤더(windowBits %i, 첫 바이트 ≠ 0x78)로 감싼 폭탄도 잡는다", (windowBits) => {
    // rhwp 는 raw 가 실패하면 zlib 으로 다시 푼다 — 유효한 zlib 헤더면 창 크기와 무관하다
    const bomb = replaceHwp5Stream(
      plain,
      "/BodyText/Section0",
      zlibWrappedBomb(256, windowBits),
    );

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("BinData 폭탄도 잡는다", () => {
    const bomb = replaceHwp5Stream(
      plain,
      "/BinData/BIN0001.bmp",
      deflateBomb(150),
    );

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("끝이 잘린 폭탄도 잡는다", () => {
    const full = deflateBomb(256);
    const truncated = full.subarray(0, full.length - 5000);
    const bomb = replaceHwp5Stream(plain, "/BodyText/Section0", truncated);

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("배포용 문서의 암호화된 ViewText 안 폭탄도 복호화해 잡는다", () => {
    const bomb = toDistributionDocument(plain, deflateBomb(256));

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("확장형 레코드 헤더(크기 < 0xFFF)의 ViewText 도 rhwp 와 같은 위치에서 복호화해 잡는다", () => {
    // rhwp 는 이때 암호문을 8+크기가 아니라 4+크기에서 읽는다 — 블록 정렬이 4바이트 어긋난다
    const bomb = toDistributionDocument(plain, deflateBomb(256), {
      extendedHeader: true,
    });

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("배포용 문서의 ViewText 가 복호화 구조가 아니면 원본 그대로 잰다", () => {
    const view = replaceHwp5Stream(
      plain,
      "/ViewText/Section0",
      deflateBomb(256),
    );
    const bomb = patchHwp5Flags(view, HWP5_FLAG.distribution);

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("루트의 /SectionN 도 본문 레코드로 센다 — rhwp 는 BodyText 가 없으면 그걸 본문으로 읽는다", () => {
    // 80MB: 스트림당 100MB 안이지만 본문 64MB 를 넘는다
    const moved = moveHwp5Stream(plain, "/BodyText/Section0", "/Section0");
    const bomb = replaceHwp5Stream(moved, "/Section0", deflateBomb(80));

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("첨부(BinData)가 아닌 스트림은 모두 본문 레코드 상한을 받는다", () => {
    const bomb = replaceHwp5Stream(
      plain,
      "/Scripts/DefaultJScript",
      deflateBomb(80),
    );

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });

  it("본문 레코드 스트림 합계가 상한을 넘으면 거부한다 (스트림 하나하나는 작아도)", () => {
    const first = replaceHwp5Stream(
      plain,
      "/BodyText/Section0",
      deflateBomb(40),
    );
    const both = replaceHwp5Stream(
      first,
      "/BodyText/Section1",
      deflateBomb(40),
    );

    expect(codeOf(() => precheckHwp5(both))).toBe("TOO_LARGE");
  });

  it("전체 합계가 상한을 넘으면 거부한다 (첨부 여러 개)", () => {
    const withBins = Array.from({ length: 6 }, (_, i) => i).reduce(
      (doc, i) =>
        replaceHwp5Stream(doc, `/BinData/BIN000${i + 1}.bmp`, deflateBomb(90)),
      plain,
    );

    expect(codeOf(() => precheckHwp5(withBins))).toBe("TOO_LARGE");
  });

  it("상한 안의 큰 스트림은 통과시킨다 (본문 50MB·첨부 90MB)", () => {
    const section = replaceHwp5Stream(
      plain,
      "/BodyText/Section0",
      deflateBomb(50),
    );
    const withBin = replaceHwp5Stream(
      section,
      "/BinData/BIN0001.bmp",
      deflateBomb(90),
    );

    expect(precheckHwp5(withBin)).toEqual([]);
  });

  it("압축 플래그가 꺼진 문서도 검사한다 — 첨부는 항목별로 압축될 수 있다", () => {
    const uncompressed = patchHwp5Flags(plain, 0, HWP5_FLAG.compressed);
    const bomb = replaceHwp5Stream(
      uncompressed,
      "/BinData/BIN0001.bmp",
      deflateBomb(150),
    );

    expect(codeOf(() => precheckHwp5(bomb))).toBe("TOO_LARGE");
  });
});

describe("decryptDistributionStream", () => {
  const section = deflateRawSync(Buffer.from("배포용 본문 레코드".repeat(20)));

  it("배포용 ViewText 를 복호화하면 원래 (압축된) 본문이 앞에 온다", () => {
    const decrypted = decryptDistributionStream(encryptViewText(section));

    expect(decrypted).not.toBeNull();
    expect(Buffer.from(decrypted ?? []).subarray(0, section.length)).toEqual(
      section,
    );
  });

  it("확장형 헤더(크기 < 0xFFF)면 암호문을 rhwp 처럼 4+크기 위치에서 읽는다", () => {
    const viewText = encryptViewText(section, undefined, {
      extendedHeader: true,
    });

    const decrypted = decryptDistributionStream(viewText);

    expect(Buffer.from(decrypted ?? []).subarray(0, section.length)).toEqual(
      section,
    );
  });

  it("끝의 16바이트 미만 조각도 rhwp 처럼 0 으로 채워 복호화한다", () => {
    const full = encryptViewText(section);
    const cut = full.subarray(0, full.length - 5);

    const decrypted = decryptDistributionStream(cut);

    expect(decrypted?.length).toBe(Math.ceil((cut.length - 260) / 16) * 16);
    const whole = Math.floor((cut.length - 260) / 16) * 16;
    expect(Buffer.from(decrypted ?? []).subarray(0, whole)).toEqual(
      Buffer.from(section).subarray(0, whole),
    );
  });

  it("암호화 본문이 없으면 빈 결과, 페이로드가 잘렸으면 null", () => {
    const full = encryptViewText(new Uint8Array(32));
    const payloadOnly = full.subarray(0, 4 + 256);
    const truncatedPayload = full.subarray(0, 100);

    expect(decryptDistributionStream(payloadOnly)).toEqual(new Uint8Array(0));
    expect(decryptDistributionStream(truncatedPayload)).toBeNull();
  });

  it("첫 레코드가 DISTRIBUTE_DOC_DATA 가 아니면 null", () => {
    expect(decryptDistributionStream(new Uint8Array(300))).toBeNull();
    expect(decryptDistributionStream(new Uint8Array(2))).toBeNull();
  });
});

describe("precheckHwp3", () => {
  it("평범한 압축 본문은 통과", () => {
    const hwp3 = buildHwp3(deflateRawSync(Buffer.alloc(4096)));

    expect(precheckHwp3(hwp3)).toEqual([]);
  });

  it("암호 표시(u16 @126 ≠ 0)면 ENCRYPTED", () => {
    const hwp3 = buildHwp3(new Uint8Array(16), { passwordFlag: 2 });

    expect(codeOf(() => precheckHwp3(hwp3))).toBe("ENCRYPTED");
  });

  it("본문 압축 폭탄이면 TOO_LARGE", () => {
    const hwp3 = buildHwp3(deflateBomb(256));

    expect(codeOf(() => precheckHwp3(hwp3))).toBe("TOO_LARGE");
  });

  it("본문은 문단 레코드라 본문 레코드 상한(64MB)을 받는다", () => {
    const hwp3 = buildHwp3(deflateBomb(80));

    expect(codeOf(() => precheckHwp3(hwp3))).toBe("TOO_LARGE");
  });

  it("헤더가 잘린 파일은 여기서 판단하지 않는다 (변환 엔진이 손상으로 알린다)", () => {
    const truncated = buildHwp3(new Uint8Array(0)).subarray(0, 200);

    expect(precheckHwp3(truncated)).toEqual([]);
  });
});

describe("measureInflatedSize", () => {
  const text = Buffer.from("hello world ".repeat(1000));

  it.each([
    9, 10, 11, 12, 13, 14, 15,
  ])("유효한 zlib 헤더(windowBits %i)면 창 크기와 무관하게 잰다", (windowBits) => {
    const wrapped = deflateSync(text, { windowBits });

    expect(measureInflatedSize(wrapped, MIB)).toBe(text.length);
  });

  it("raw deflate 도 잰다", () => {
    expect(measureInflatedSize(deflateRawSync(text), MIB)).toBe(text.length);
  });

  it("압축 데이터가 아니면 0, 상한을 넘으면 Infinity", () => {
    expect(measureInflatedSize(new Uint8Array([0xff, 0xff, 0xff]), MIB)).toBe(
      0,
    );
    expect(measureInflatedSize(deflateBomb(2), MIB)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
