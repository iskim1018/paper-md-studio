/**
 * @rhwp/core 계약 테스트 (core 쪽 — 변환 경로).
 *
 * 우리는 rhwp 의 오류를 **문구로** 분류한다(rhwp 가 문자열만 던지기 때문). rhwp 를
 * 올렸을 때 문구가 바뀌면 분류가 조용히 "변환 실패"로 떨어지므로, 실제 rhwp 로
 * 각 오류를 일으켜 우리가 기대는 문구와 분류 결과를 함께 고정한다. 쓰는 API 가
 * 사라지거나 이름이 바뀌어도 여기서 먼저 깨진다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  RHWP_INVALID_FILE_PREFIX,
  RHWP_PATTERNS,
  toHwpConversionError,
} from "../src/parsers/hwp/errors.js";
import { loadRhwp } from "../src/parsers/hwp/rhwp-loader.js";
import {
  buildCfb,
  createEncryptedHwp5,
  createHwp5,
  hwpmlDocument,
} from "./helpers/hwp-fixtures.js";

type Rhwp = Awaited<ReturnType<typeof loadRhwp>>;

let rhwp: Rhwp;

beforeAll(async () => {
  rhwp = await loadRhwp();
});

/** rhwp 생성자가 던진 값을 그대로 받는다 */
function rawThrow(data: Uint8Array): unknown {
  try {
    new rhwp.HwpDocument(data).free();
  } catch (err) {
    return err;
  }
  throw new Error("rhwp 가 예외 없이 열었다");
}

const encoder = new TextEncoder();

describe("@rhwp/core API 표면", () => {
  it("변환·생성에 쓰는 메서드가 있다", () => {
    const docMethods = [
      "createBlankDocument",
      "insertText",
      "exportHwp",
      "exportHwpWithPassword",
      "exportHwpxWithReport",
      "getSourceFormat",
      "free",
    ];
    const exportMethods = ["takeBytes", "contentLoss", "free"];
    const docProto = rhwp.HwpDocument.prototype as unknown as Record<
      string,
      unknown
    >;
    const exportProto = rhwp.DocumentExport.prototype as unknown as Record<
      string,
      unknown
    >;

    for (const name of docMethods) {
      expect(typeof docProto[name], name).toBe("function");
    }
    for (const name of exportMethods) {
      expect(typeof exportProto[name], name).toBe("function");
    }
    expect(typeof rhwp.HwpDocument.createEmpty).toBe("function");
    expect(typeof rhwp.default).toBe("function");
  });

  it("content-loss 보고서 스키마(v1)를 지킨다", async () => {
    const doc = new rhwp.HwpDocument(await createHwp5("스키마"));
    const exported = doc.exportHwpxWithReport();
    try {
      const report = JSON.parse(exported.contentLoss()) as Record<
        string,
        unknown
      >;

      expect(report.schemaVersion).toBe(1);
      expect(report.outputFormat).toBe("hwpx");
      expect(Array.isArray(report.losses)).toBe(true);
      expect(exported.takeBytes().length).toBeGreaterThan(0);
    } finally {
      exported.free();
      doc.free();
    }
  });

  it("HWP 5.0·HWPML 의 원본 형식을 구분해 알려준다", async () => {
    const hwp = new rhwp.HwpDocument(await createHwp5("형식"));
    const hml = new rhwp.HwpDocument(encoder.encode(hwpmlDocument()));
    try {
      expect(hwp.getSourceFormat()).toBe("hwp");
      expect(hml.getSourceFormat()).toBe("hml");
    } finally {
      hwp.free();
      hml.free();
    }
  });
});

describe("@rhwp/core 오류 문구 계약", () => {
  it("오류는 Error 가 아닌 문자열이고 공통 접두어로 시작한다", () => {
    const raw = rawThrow(new Uint8Array(0));

    expect(typeof raw).toBe("string");
    expect(String(raw).startsWith(RHWP_INVALID_FILE_PREFIX)).toBe(true);
  });

  it("빈 파일 → EMPTY_FILE", () => {
    const raw = String(rawThrow(new Uint8Array(0)));

    expect(raw).toContain(RHWP_PATTERNS.emptyFile);
    expect(toHwpConversionError(raw).code).toBe("EMPTY");
  });

  it("알 수 없는 형식 → UNSUPPORTED_FILE_FORMAT", () => {
    const raw = String(rawThrow(encoder.encode("%PDF-1.7 아님")));

    expect(raw).toContain(RHWP_PATTERNS.unsupportedFormat);
    expect(toHwpConversionError(raw).code).toBe("UNSUPPORTED");
  });

  it("보안 컨테이너(SoftCamp SCDSA) → DRM_PROTECTED", () => {
    const wrapper = new Uint8Array(256).fill(0x5a);
    wrapper.set(encoder.encode("SCDSA002"));
    const raw = String(rawThrow(wrapper));

    expect(raw).toContain(RHWP_PATTERNS.drmProtected);
    expect(toHwpConversionError(raw).code).toBe("DRM_PROTECTED");
  });

  it("암호 문서 → 비밀번호가 필요한 암호 문서", async () => {
    const raw = String(rawThrow(await createEncryptedHwp5("비밀", "pw")));

    expect(raw).toContain(RHWP_PATTERNS.passwordRequired);
    expect(toHwpConversionError(raw).code).toBe("ENCRYPTED");
  });

  it("HWPML 미지원 버전 → 지원하지 않는 HWPML 버전입니다: <버전>", () => {
    const raw = String(
      rawThrow(encoder.encode(hwpmlDocument({ version: "2.8" }))),
    );

    expect(RHWP_PATTERNS.hwpmlVersion.exec(raw)?.[1]).toBe("2.8");
    expect(toHwpConversionError(raw).code).toBe("HWPML_VERSION");
  });

  it("HEAD 없는 HWPML → HML 오류 (손상)", () => {
    const raw = String(
      rawThrow(encoder.encode(hwpmlDocument({ version: "2.91", head: false }))),
    );

    expect(raw).toContain(`${RHWP_INVALID_FILE_PREFIX}HML 오류`);
    expect(toHwpConversionError(raw).code).toBe("CORRUPTED");
  });

  it("FileHeader 없는 OLE2 → CFB 오류 (손상)", () => {
    const raw = String(rawThrow(buildCfb({ Other: new Uint8Array(64) })));

    expect(raw).toContain(`${RHWP_INVALID_FILE_PREFIX}CFB 오류`);
    expect(toHwpConversionError(raw).code).toBe("CORRUPTED");
  });

  it("시그니처만 있는 HWP 3.0 → HWP 3.0 오류 (손상)", () => {
    const raw = String(
      rawThrow(encoder.encode(`HWP Document File V3.00 ${"\0".repeat(64)}`)),
    );

    expect(raw).toContain(`${RHWP_INVALID_FILE_PREFIX}HWP 3.0 오류`);
    expect(toHwpConversionError(raw).code).toBe("CORRUPTED");
  });
});
