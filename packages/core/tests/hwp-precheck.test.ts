import { deflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptDistributionStream } from "../src/parsers/hwp/distribution.js";
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
  patchHwp5Flags,
  replaceHwp5Stream,
  toDistributionDocument,
  zlibWrappedBomb,
} from "./helpers/hwp-fixtures.js";

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
  it("배포용 ViewText 를 복호화하면 원래 (압축된) 본문이 앞에 온다", () => {
    const section = deflateRawSync(
      Buffer.from("배포용 본문 레코드".repeat(20)),
    );

    const decrypted = decryptDistributionStream(encryptViewText(section));

    expect(decrypted).not.toBeNull();
    expect(Buffer.from(decrypted ?? []).subarray(0, section.length)).toEqual(
      section,
    );
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

  it("헤더가 잘린 파일은 여기서 판단하지 않는다 (변환 엔진이 손상으로 알린다)", () => {
    const truncated = buildHwp3(new Uint8Array(0)).subarray(0, 200);

    expect(precheckHwp3(truncated)).toEqual([]);
  });
});
