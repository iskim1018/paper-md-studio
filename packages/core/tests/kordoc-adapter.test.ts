import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HwpParser } from "../src/parsers/hwp-parser.js";
import {
  detectBinaryFormat,
  ensureOfflineDefault,
  failureMessage,
  KordocParser,
  rewriteImageRefs,
  toImageAssets,
  toWarningMessages,
} from "../src/parsers/kordoc-adapter.js";
import { convert } from "../src/pipeline.js";

// ─── 합성 픽스처 ─────────────────────────────────────────

/** 최소 구조의 XLSX (inlineStr 셀, 공유 문자열 없음) */
function buildMinimalXlsx(): Uint8Array {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="명단" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>이름</t></is></c>
      <c r="B1" t="inlineStr"><is><t>직급</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>홍길동</t></is></c>
      <c r="B2" t="inlineStr"><is><t>과장</t></is></c>
    </row>
  </sheetData>
</worksheet>`;

  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

/** 최소 구조의 HWPML (XML 기반 .hwp) */
const MINIMAL_HWPML = `<?xml version="1.0" encoding="UTF-8"?>
<HWPML Version="2.8">
  <BODY>
    <SECTION>
      <P><TEXT><CHAR>kordoc 위임 경로 검증 문장</CHAR></TEXT></P>
    </SECTION>
  </BODY>
</HWPML>`;

/** HWP 3.x 시그니처 (+ 본문은 없는 손상 파일) */
const HWP3_SIGNATURE = "HWP Document File V3.00 ";

/** OLE2(CFB) 매직바이트 — HWP 5.x·XLS 공통 컨테이너 */
const OLE2_MAGIC = new Uint8Array([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

// ─── 순수 헬퍼 단위 테스트 ───────────────────────────────

describe("failureMessage", () => {
  it("알려진 에러 코드는 한국어 안내 메시지로 변환한다", () => {
    const message = failureMessage("ENCRYPTED", "password required");

    expect(message).toContain("암호로 보호된 문서");
    expect(message).toContain("password required");
  });

  it("모르는 코드는 원본 에러를 담은 일반 실패 메시지를 반환한다", () => {
    const message = failureMessage("SOMETHING_NEW", "novel failure");

    expect(message).toBe("문서 변환에 실패했습니다: novel failure");
  });

  it("코드가 없으면 일반 실패 메시지를 반환한다", () => {
    const message = failureMessage(undefined, "no code");

    expect(message).toBe("문서 변환에 실패했습니다: no code");
  });
});

describe("rewriteImageRefs", () => {
  it("파일명 직접 참조를 이미지 디렉토리 상대경로로 재작성한다", () => {
    const markdown = "본문 ![그림](image_001.png) 끝";

    const result = rewriteImageRefs(
      markdown,
      ["image_001.png"],
      "보고서_images",
    );

    expect(result).toBe("본문 ![그림](./보고서_images/image_001.png) 끝");
  });

  it("같은 이미지의 다중 참조를 모두 재작성한다", () => {
    const markdown = "![a](img.png)\n![b](img.png)";

    const result = rewriteImageRefs(markdown, ["img.png"], "d_images");

    expect(result).toBe("![a](./d_images/img.png)\n![b](./d_images/img.png)");
  });

  it("이미지 목록에 없는 참조는 건드리지 않는다", () => {
    const markdown = "![외부](https://example.com/a.png)";

    const result = rewriteImageRefs(markdown, ["img.png"], "d_images");

    expect(result).toBe(markdown);
  });
});

describe("toImageAssets", () => {
  it("kordoc ExtractedImage를 프로젝트 ImageAsset으로 매핑한다", () => {
    const data = new Uint8Array([1, 2, 3]);

    const assets = toImageAssets([
      { filename: "image_001.png", data, mimeType: "image/png" },
    ]);

    expect(assets).toEqual([
      { name: "image_001.png", data, mimeType: "image/png" },
    ]);
  });
});

describe("toWarningMessages", () => {
  it("페이지 번호가 있으면 접두어를 붙인다", () => {
    const messages = toWarningMessages([
      { page: 3, message: "이미지 추출 실패" },
      { message: "글꼴 정보 없음" },
    ]);

    expect(messages).toEqual(["3쪽: 이미지 추출 실패", "글꼴 정보 없음"]);
  });
});

describe("ensureOfflineDefault", () => {
  it("미설정이면 KORDOC_OFFLINE=1을 기본값으로 강제한다", () => {
    const saved = process.env.KORDOC_OFFLINE;
    try {
      delete process.env.KORDOC_OFFLINE;

      ensureOfflineDefault();

      expect(process.env.KORDOC_OFFLINE).toBe("1");
    } finally {
      if (saved === undefined) {
        delete process.env.KORDOC_OFFLINE;
      } else {
        process.env.KORDOC_OFFLINE = saved;
      }
    }
  });

  it("사용자가 명시한 값은 덮어쓰지 않는다", () => {
    const saved = process.env.KORDOC_OFFLINE;
    try {
      process.env.KORDOC_OFFLINE = "0";

      ensureOfflineDefault();

      expect(process.env.KORDOC_OFFLINE).toBe("0");
    } finally {
      if (saved === undefined) {
        delete process.env.KORDOC_OFFLINE;
      } else {
        process.env.KORDOC_OFFLINE = saved;
      }
    }
  });
});

// ─── kordoc 계약 테스트 (버전 업 시 API 표면 검증) ────────

describe("kordoc 계약: detectBinaryFormat", () => {
  it("HWP 3.x 시그니처를 hwp3로 판별한다", () => {
    const buffer = Buffer.from(HWP3_SIGNATURE + "\0".repeat(64), "latin1");

    expect(detectBinaryFormat(buffer)).toBe("hwp3");
  });

  it("XML 기반 HWPML을 hwpml로 판별한다", () => {
    const buffer = Buffer.from(MINIMAL_HWPML, "utf-8");

    expect(detectBinaryFormat(buffer)).toBe("hwpml");
  });

  it("OLE2 컨테이너(HWP 5.x)를 hwp로 판별한다", () => {
    const buffer = Buffer.concat([Buffer.from(OLE2_MAGIC), Buffer.alloc(512)]);

    expect(detectBinaryFormat(buffer)).toBe("hwp");
  });

  it("ZIP 컨테이너는 hwpx로 뭉뚱그린다 — xlsx 라우팅에 확장자를 쓰는 근거", () => {
    const buffer = Buffer.from(buildMinimalXlsx());

    expect(detectBinaryFormat(buffer)).toBe("hwpx");
  });
});

describe("kordoc 계약: KordocParser 변환", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kordoc-adapter-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("XLSX를 마크다운 표로 변환한다", async () => {
    const xlsxPath = join(tmpDir, "명단.xlsx");
    await writeFile(xlsxPath, buildMinimalXlsx());

    const result = await new KordocParser().parse(xlsxPath, {
      imagesDirName: "명단_images",
    });

    expect(result.html).toBeNull();
    expect(result.markdown).toContain("홍길동");
    expect(result.markdown).toContain("과장");
    expect(result.images).toEqual([]);
  });

  it("HWPML을 마크다운으로 변환한다", async () => {
    const hwpmlPath = join(tmpDir, "구공문.hwp");
    await writeFile(hwpmlPath, MINIMAL_HWPML, "utf-8");

    const result = await new KordocParser().parse(hwpmlPath, {
      imagesDirName: "구공문_images",
    });

    expect(result.markdown).toContain("kordoc 위임 경로 검증 문장");
  });

  it("해석 불가 파일은 한국어 에러 메시지로 실패한다", async () => {
    const badPath = join(tmpDir, "깨진파일.xls");
    await writeFile(badPath, "garbage-not-a-document", "utf-8");

    await expect(
      new KordocParser().parse(badPath, { imagesDirName: "x_images" }),
    ).rejects.toThrow(/지원하지 않는 문서 형식|문서 변환에 실패|손상/);
  });

  it("변환 후 KORDOC_OFFLINE 기본값이 유지된다", () => {
    expect(process.env.KORDOC_OFFLINE).toBe("1");
  });
});

describe("파이프라인 라우팅", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kordoc-pipeline-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("convert()가 .xlsx를 xlsx 포맷으로 변환한다", async () => {
    const xlsxPath = join(tmpDir, "직원명단.xlsx");
    await writeFile(xlsxPath, buildMinimalXlsx());

    const result = await convert({ inputPath: xlsxPath });

    expect(result.format).toBe("xlsx");
    expect(result.markdown).toContain("홍길동");
  });

  it("HwpParser가 HWP 3.x를 Java 경로 대신 kordoc으로 라우팅한다", async () => {
    // 시그니처만 있는 손상 HWP3 — kordoc 경로로 갔다면 kordoc의 파싱 에러가,
    // Java 경로로 갔다면 "HWP → HWPX 변환 실패"/"Java 런타임" 에러가 난다.
    const hwp3Path = join(tmpDir, "옛문서.hwp");
    await writeFile(
      hwp3Path,
      Buffer.from(HWP3_SIGNATURE + "\0".repeat(64), "latin1"),
    );

    await expect(
      new HwpParser().parse(hwp3Path, { imagesDirName: "옛문서_images" }),
    ).rejects.toThrow(/^(?!.*HWP → HWPX 변환 실패)(?!.*Java 런타임).*$/s);
  });

  it("HwpParser가 HWPML을 Java 없이 변환한다", async () => {
    const hwpmlPath = join(tmpDir, "구식공문.hwp");
    await writeFile(hwpmlPath, MINIMAL_HWPML, "utf-8");

    const result = await new HwpParser().parse(hwpmlPath, {
      imagesDirName: "구식공문_images",
    });

    expect(result.markdown).toContain("kordoc 위임 경로 검증 문장");
  });
});
