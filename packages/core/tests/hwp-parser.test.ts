import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MERGE_LEFT } from "../src/parsers/html-tables-to-gfm.js";
import { convertWithRhwp } from "../src/parsers/hwp/rhwp-loader.js";
import { HwpParser, resolveHwp5Engine } from "../src/parsers/hwp-parser.js";
import { HwpxParser } from "../src/parsers/hwpx-parser.js";
import { convert } from "../src/pipeline.js";
import {
  buildCfb,
  buildHwp3,
  createEncryptedHwp5,
  createHwp5,
  deflateBomb,
  HWP5_FLAG,
  hwpmlDocument,
  patchHwp5Flags,
  replaceHwp5Stream,
  toDistributionDocument,
} from "./helpers/hwp-fixtures.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE_HWP = resolve(FIXTURES, "sample.hwp");
// 보안상 sample.hwp는 저장소에 포함하지 않음. 없으면 Java 의존 테스트 skip.
const hasHwpSample = existsSync(SAMPLE_HWP);

/** CI 환경에 Java가 없으면 Java 의존 테스트를 스킵한다. */
function isJavaAvailable(): boolean {
  try {
    execSync("java -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const javaAvailable = isJavaAvailable();

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hwp-parser-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** 임시 파일로 써서 HwpParser 로 변환한다 */
async function parseBytes(
  name: string,
  data: Uint8Array | string,
): Promise<Awaited<ReturnType<HwpParser["parse"]>>> {
  const path = join(tmpDir, name);
  await writeFile(path, data);
  return new HwpParser().parse(path, { imagesDirName: "doc_images" });
}

/** 변환 실패를 받아 Error 인지·한국어 메시지인지 확인하고 돌려준다 */
async function parseError(
  name: string,
  data: Uint8Array | string,
): Promise<{ code?: string; message: string }> {
  const error = await parseBytes(name, data).then(
    () => {
      throw new Error("변환이 실패해야 한다");
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(Error);
  const { message } = error as Error;
  expect(message).toMatch(/[가-힣]/);
  expect(message).not.toMatch(/rhwp|parse_|오류코드/);
  return { code: (error as { code?: string }).code, message };
}

function withEngine(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.PAPER_MD_STUDIO_HWP_ENGINE;
  } else {
    process.env.PAPER_MD_STUDIO_HWP_ENGINE = value;
  }
}

describe.skipIf(!javaAvailable || !hasHwpSample)(
  "HwpParser (Java 폴백 경로)",
  () => {
    // 기본값은 rhwp 다. 이 블록은 폴백으로 남겨둔 Java 경로를 검증하므로
    // env를 명시적으로 고정해야 한다 — 안 그러면 이름과 달리 rhwp를 재게 된다.
    let prevEngine: string | undefined;
    beforeEach(() => {
      prevEngine = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
      process.env.PAPER_MD_STUDIO_HWP_ENGINE = "java";
    });
    afterEach(() => {
      withEngine(prevEngine);
    });

    it("HWP 바이너리를 HWPX로 선변환 후 Markdown을 생성한다", async () => {
      const result = await convert({ inputPath: SAMPLE_HWP });

      expect(result.format).toBe("hwp");
      expect(result.markdown.length).toBeGreaterThan(0);
      expect(result.elapsed).toBeGreaterThan(0);
      expect(Array.isArray(result.images)).toBe(true);
    });

    it("추출된 이미지는 정상적인 형태를 가진다", async () => {
      const result = await convert({ inputPath: SAMPLE_HWP });

      for (const img of result.images) {
        expect(img.name).toMatch(/^img_\d{3}\.[a-z]+$/);
        expect(img.mimeType).toMatch(/^image\//);
        expect(img.data.length).toBeGreaterThan(0);
      }
    });

    it("PAPER_MD_STUDIO_HWP_JAR이 존재하지 않는 경로면 명확한 오류를 던진다", async () => {
      const prev = process.env.PAPER_MD_STUDIO_HWP_JAR;
      process.env.PAPER_MD_STUDIO_HWP_JAR = "/nonexistent/path/to/hwp.jar";
      try {
        const parser = new HwpParser();
        await expect(
          parser.parse(SAMPLE_HWP, { imagesDirName: "sample_images" }),
        ).rejects.toThrow(/PAPER_MD_STUDIO_HWP_JAR/);
      } finally {
        if (prev === undefined) {
          delete process.env.PAPER_MD_STUDIO_HWP_JAR;
        } else {
          process.env.PAPER_MD_STUDIO_HWP_JAR = prev;
        }
      }
    });
  },
);

describe("resolveHwp5Engine (엔진 선택)", () => {
  it("플래그가 없으면 rhwp 를 쓴다", () => {
    expect(resolveHwp5Engine({})).toBe("rhwp");
  });

  it("PAPER_MD_STUDIO_HWP_ENGINE=java면 Java 툴체인으로 되돌린다", () => {
    expect(resolveHwp5Engine({ PAPER_MD_STUDIO_HWP_ENGINE: "java" })).toBe(
      "java",
    );
  });

  it("모르는 값(이전 기본값 kordoc 포함)은 무시하고 rhwp 로 간다 — 오타로 엔진이 바뀌면 안 된다", () => {
    for (const value of ["Java", "JAVA", "jaav", "", " java", "kordoc"]) {
      expect(resolveHwp5Engine({ PAPER_MD_STUDIO_HWP_ENGINE: value })).toBe(
        "rhwp",
      );
    }
  });

  it("인자를 생략하면 process.env를 읽는다", () => {
    const prev = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
    process.env.PAPER_MD_STUDIO_HWP_ENGINE = "java";
    try {
      expect(resolveHwp5Engine()).toBe("java");
    } finally {
      withEngine(prev);
    }
  });
});

describe("HwpParser — HWP 5.0 (rhwp 경로)", () => {
  it("본문을 HWPX 경유로 HTML 로 내린다", async () => {
    const hwp = await createHwp5("rhwp 경로 검증 문장");

    const result = await parseBytes("본문.hwp", hwp);

    expect(result.html).toContain("rhwp 경로 검증 문장");
    expect(result.warnings).toBeUndefined();
  });

  it("배포용 문서(ViewText 암호화)도 변환한다", async () => {
    const hwp = toDistributionDocument(await createHwp5("배포용 본문"));

    const result = await parseBytes("배포용.hwp", hwp);

    expect(result.html).toContain("배포용 본문");
  });

  it("변경 추적 문서는 변환하되 경고를 붙인다", async () => {
    const hwp = patchHwp5Flags(
      await createHwp5("추적 본문"),
      HWP5_FLAG.trackChanges,
    );

    const result = await parseBytes("추적.hwp", hwp);

    expect(result.html).toContain("추적 본문");
    expect(result.warnings).toEqual([
      "변경 추적이 켜진 문서입니다. 삭제 표시된 내용이 본문에 섞여 나올 수 있습니다.",
    ]);
  });

  it("암호 문서는 한국어 ENCRYPTED 오류", async () => {
    const encrypted = await createEncryptedHwp5("비밀", "pw");

    const { code, message } = await parseError("암호.hwp", encrypted);

    expect(code).toBe("ENCRYPTED");
    expect(message).toContain("암호로 보호된 문서");
  });

  it("DRM 비트가 켜진 문서는 거부한다 — 엔진은 이 비트를 무시한다", async () => {
    const drm = patchHwp5Flags(await createHwp5("보안"), HWP5_FLAG.drm);

    expect((await parseError("drm.hwp", drm)).code).toBe("DRM_PROTECTED");
  });

  it("압축 폭탄은 엔진에 닿기 전에 빠르게 거부한다", async () => {
    const plain = await createHwp5("폭탄");
    const bomb = replaceHwp5Stream(
      plain,
      "/BodyText/Section0",
      deflateBomb(256),
    );
    const start = performance.now();

    const { code } = await parseError("폭탄.hwp", bomb);

    expect(code).toBe("TOO_LARGE");
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it("Java 엔진을 골라도 사전 검사(암호)는 먼저 한다", async () => {
    const prev = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
    withEngine("java");
    try {
      const encrypted = await createEncryptedHwp5("비밀", "pw");

      expect((await parseError("자바암호.hwp", encrypted)).code).toBe(
        "ENCRYPTED",
      );
    } finally {
      withEngine(prev);
    }
  });

  it("FileHeader 없이 Workbook 만 있으면 엑셀이라고 알려준다", async () => {
    const xls = buildCfb({ Workbook: new Uint8Array(64) });

    const { code, message } = await parseError("표.hwp", xls);

    expect(code).toBe("XLS_MISNAMED");
    expect(message).toContain(".xls");
  });
});

describe("HwpParser — HWPML (rhwp 경로)", () => {
  it("HWPML 병합 표를 GFM + 병합 화살표로 내린다", async () => {
    // HWPML 의 병합 표도 다른 포맷과 같은 GFM 계약을 따라야 한다.
    const result = await convert({
      inputPath: await writeTmp("구공문서.hwp", hwpmlDocument()),
    });

    expect(result.markdown).toContain("표 앞 문단");
    expect(result.markdown).toContain(`| 병합 제목 | ${MERGE_LEFT} |`);
    expect(result.markdown).toContain("| 가 | 나 |");
    expect(result.markdown).not.toContain("<table");
    expect(result.warnings).toBeUndefined();
  });

  it("미지원 버전(2.8)은 2.91 로 간주해 같은 결과를 내고 경고한다", async () => {
    const result = await convert({
      inputPath: await writeTmp(
        "옛버전.hwp",
        hwpmlDocument({ version: "2.8" }),
      ),
    });

    expect(result.markdown).toContain(`| 병합 제목 | ${MERGE_LEFT} |`);
    expect(result.warnings).toEqual([
      "HWPML 버전 2.8은(는) 직접 지원하지 않아 2.91로 간주해 변환했습니다. 일부 내용이 원본과 다를 수 있습니다.",
    ]);
  });

  it("UTF-16LE HWPML 도 변환한다", async () => {
    const text = hwpmlDocument().replace(
      'encoding="UTF-8"',
      'encoding="UTF-16"',
    );
    const utf16 = new Uint8Array(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
    );

    const result = await parseBytes("utf16.hwp", utf16);

    expect(result.html).toContain("병합 제목");
  });

  it("Java 엔진을 골라도 HWPML 은 rhwp 로 간다 (Java 는 HWP 5.0 전용)", async () => {
    const prev = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
    withEngine("java");
    try {
      const result = await parseBytes("자바.hwp", hwpmlDocument());

      expect(result.html).toContain("표 앞 문단");
    } finally {
      withEngine(prev);
    }
  });
});

describe("HwpParser — HWP 3.0", () => {
  it("시그니처만 있는 손상 HWP3 는 Java 오류가 아닌 한국어 손상 오류", async () => {
    // Java 경로로 샜다면 "HWP → HWPX 변환 실패"/"Java 런타임" 오류가 난다
    const prev = process.env.PAPER_MD_STUDIO_HWP_ENGINE;
    withEngine("java");
    try {
      const broken = new Uint8Array(
        Buffer.from(`HWP Document File V3.00 ${"\0".repeat(64)}`, "latin1"),
      );

      const { code, message } = await parseError("옛문서.hwp", broken);

      expect(code).toBe("CORRUPTED");
      expect(message).not.toMatch(/Java|HWP → HWPX/);
    } finally {
      withEngine(prev);
    }
  });

  it("암호 표시가 있으면 ENCRYPTED", async () => {
    const hwp3 = buildHwp3(new Uint8Array(16), { passwordFlag: 2 });

    expect((await parseError("옛암호.hwp", hwp3)).code).toBe("ENCRYPTED");
  });

  it("본문 압축 폭탄이면 TOO_LARGE", async () => {
    const hwp3 = buildHwp3(deflateBomb(256));

    expect((await parseError("옛폭탄.hwp", hwp3)).code).toBe("TOO_LARGE");
  });
});

describe("HwpParser — HWPX 를 .hwp 로 저장한 파일", () => {
  it(".hwpx 로 열었을 때와 같은 결과를 낸다", async () => {
    // Arrange — 같은 HWPX 바이트를 두 확장자로 저장
    const { hwpx } = await convertWithRhwp(await createHwp5("확장자만 다름"));
    const asHwp = await writeTmp("이름만hwp.hwp", hwpx);
    const asHwpx = await writeTmp("이름만hwp.hwpx", hwpx);

    // Act
    const fromHwp = await convert({ inputPath: asHwp });
    const fromHwpx = await convert({ inputPath: asHwpx });

    // Assert
    expect(fromHwp.markdown).toContain("확장자만 다름");
    expect(fromHwp.markdown).toBe(fromHwpx.markdown);
  });

  it("HWPX 가 아닌 ZIP(DOCX 등)은 그 사실을 알려준다", async () => {
    const docx = zipSync({ "word/document.xml": strToU8("<w:document/>") });

    const { code, message } = await parseError("문서.hwp", docx);

    expect(code).toBe("UNSUPPORTED");
    expect(message).toContain("HWPX 가 아닌 ZIP");
  });
});

describe("HwpParser — 한글 문서가 아닌 입력", () => {
  it("빈 파일 → EMPTY", async () => {
    expect((await parseError("빈.hwp", new Uint8Array(0))).code).toBe("EMPTY");
  });

  it("옛 시그니처(V2.00) → LEGACY_VERSION 과 버전 안내", async () => {
    const legacy = new Uint8Array(Buffer.from("HWP Document File V2.00 \x1a"));

    const { code, message } = await parseError("2.0.hwp", legacy);

    expect(code).toBe("LEGACY_VERSION");
    expect(message).toContain("V2.00");
  });

  it("PDF·텍스트를 .hwp 로 저장한 파일 → UNSUPPORTED", async () => {
    expect((await parseError("pdf.hwp", "%PDF-1.7\n...")).code).toBe(
      "UNSUPPORTED",
    );
    expect((await parseError("txt.hwp", "그냥 텍스트")).code).toBe(
      "UNSUPPORTED",
    );
  });

  it("보안 컨테이너(DRM)로 감싼 파일은 DRM 이라고 알려준다", async () => {
    const wrapper = new Uint8Array(8192).fill(0x5a);
    wrapper.set(new TextEncoder().encode("SCDSA002"));

    expect((await parseError("보안.hwp", wrapper)).code).toBe("DRM_PROTECTED");
  });
});

describe("HwpParser — HWPX 해석 단계 오류", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("한국어가 아닌 파서 오류는 한국어 메시지로 감싼다", async () => {
    vi.spyOn(HwpxParser.prototype, "parse").mockRejectedValue(
      new Error("invalid zip data"),
    );
    const hwp = await createHwp5("감싸기");

    const { code, message } = await parseError("감싸기.hwp", hwp);

    expect(code).toBe("CONVERSION_FAILED");
    expect(message).toContain("HWPX 해석 실패: invalid zip data");
  });

  it("이미 한국어인 파서 오류는 그대로 둔다", async () => {
    const original = new Error("암호화된 HWPX 입니다.");
    vi.spyOn(HwpxParser.prototype, "parse").mockRejectedValue(original);
    const hwp = await createHwp5("그대로");

    await expect(parseBytes("그대로.hwp", hwp)).rejects.toBe(original);
  });
});

describe("HwpParser (포맷 등록)", () => {
  it("pipeline이 .hwp 확장자를 지원 포맷으로 인식한다", async () => {
    // 지원하지 않는 확장자의 에러 메시지에 .hwp 가 지원 목록으로 나오는지 본다
    await expect(convert({ inputPath: "fake.unknown" })).rejects.toThrow(
      /\.hwp/,
    );
  });
});

async function writeTmp(
  name: string,
  data: Uint8Array | string,
): Promise<string> {
  const path = join(tmpDir, name);
  await writeFile(path, data);
  return path;
}
