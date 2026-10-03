import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HwpConversionError } from "../src/parsers/hwp/errors.js";
import {
  convertHwpmlWithRhwp,
  convertWithRhwp,
  loadRhwp,
} from "../src/parsers/hwp/rhwp-loader.js";
import { createHwp5, hwpmlDocument } from "./helpers/hwp-fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function sectionXml(hwpx: Uint8Array): string {
  const files = unzipSync(hwpx);
  const section = files["Contents/section0.xml"];
  if (!section) {
    throw new Error("section0.xml 없음");
  }
  return new TextDecoder().decode(section);
}

describe("loadRhwp", () => {
  it("초기화는 한 번만 한다 — 같은 모듈을 돌려준다", async () => {
    const [a, b] = await Promise.all([loadRhwp(), loadRhwp()]);

    expect(a).toBe(b);
    expect(typeof a.HwpDocument).toBe("function");
  });
});

describe("convertWithRhwp", () => {
  it("HWP 5.0 바이트를 HWPX(zip) 로 내보내고 본문 텍스트를 보존한다", async () => {
    // Arrange
    const hwp = await createHwp5("변환 확인 문장");

    // Act
    const result = await convertWithRhwp(hwp);

    // Assert
    expect(result.hwpx[0]).toBe(0x50); // 'P'
    expect(result.hwpx[1]).toBe(0x4b); // 'K'
    expect(sectionXml(result.hwpx)).toContain("변환 확인 문장");
    expect(result.warnings).toEqual([]);
  });

  it("문서와 내보내기 결과를 성공·실패 모두에서 free 한다 (WASM 메모리는 줄지 않는다)", async () => {
    // Arrange
    const rhwp = await loadRhwp();
    const hwp = await createHwp5("해제 확인");
    const docFree = vi.spyOn(rhwp.HwpDocument.prototype, "free");
    const exportFree = vi.spyOn(rhwp.DocumentExport.prototype, "free");

    // Act — 성공
    await convertWithRhwp(hwp);

    // Assert
    expect(docFree).toHaveBeenCalledTimes(1);
    expect(exportFree).toHaveBeenCalledTimes(1);

    // Act — 내보내기 실패 (rhwp 는 문자열을 던진다)
    vi.spyOn(
      rhwp.HwpDocument.prototype,
      "exportHwpxWithReport",
    ).mockImplementation(() => {
      throw "렌더링 오류: XML 쓰기 실패";
    });
    await expect(convertWithRhwp(hwp)).rejects.toBeInstanceOf(
      HwpConversionError,
    );

    // Assert
    expect(docFree).toHaveBeenCalledTimes(2);
  });

  it("문자열 오류도 한국어 메시지의 Error 로 바꿔 던진다", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const error = await convertWithRhwp(garbage).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "UNSUPPORTED" });
    expect((error as Error).message).not.toMatch(/rhwp/);
  });
});

describe("convertHwpmlWithRhwp (버전 대체)", () => {
  it("지원 버전(2.91)은 그대로 변환하고 경고가 없다", async () => {
    const data = new TextEncoder().encode(hwpmlDocument({ version: "2.91" }));

    const result = await convertHwpmlWithRhwp(data);

    expect(sectionXml(result.hwpx)).toContain("병합 제목");
    expect(result.warnings).toEqual([]);
  });

  it("미지원 버전(2.8)은 2.91 로 간주해 한 번 더 시도하고 경고를 남긴다", async () => {
    const data = new TextEncoder().encode(hwpmlDocument({ version: "2.8" }));

    const result = await convertHwpmlWithRhwp(data);

    expect(sectionXml(result.hwpx)).toContain("병합 제목");
    expect(result.warnings).toEqual([
      "HWPML 버전 2.8은(는) 직접 지원하지 않아 2.91로 간주해 변환했습니다. 일부 내용이 원본과 다를 수 있습니다.",
    ]);
  });

  it("Version 속성이 없어도 HEAD 가 있으면 2.91 로 간주한다", async () => {
    const data = new TextEncoder().encode(hwpmlDocument({ version: null }));

    const result = await convertHwpmlWithRhwp(data);

    expect(sectionXml(result.hwpx)).toContain("병합 제목");
    expect(result.warnings).toEqual([
      "HWPML 버전 정보가 없어 2.91로 간주해 변환했습니다. 일부 내용이 원본과 다를 수 있습니다.",
    ]);
  });

  it("HEAD 가 없으면 재시도하지 않고 버전 오류를 낸다", async () => {
    const data = new TextEncoder().encode(
      hwpmlDocument({ version: "2.8", head: false }),
    );

    await expect(convertHwpmlWithRhwp(data)).rejects.toMatchObject({
      code: "HWPML_VERSION",
    });
  });

  it("지원 버전인데 HEAD 가 없으면 손상으로 본다", async () => {
    const data = new TextEncoder().encode(
      hwpmlDocument({ version: "2.91", head: false }),
    );

    await expect(convertHwpmlWithRhwp(data)).rejects.toMatchObject({
      code: "CORRUPTED",
    });
  });
});
