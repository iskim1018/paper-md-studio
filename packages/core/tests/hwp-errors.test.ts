import { describe, expect, it } from "vitest";
import {
  HwpConversionError,
  sanitizeDetail,
  toHwpConversionError,
} from "../src/parsers/hwp/errors.js";

describe("HwpConversionError", () => {
  it("코드와 한국어 기본 문구를 가지며 세부 내용은 괄호로 붙는다", () => {
    const error = new HwpConversionError("CORRUPTED", "스트림 없음");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CORRUPTED");
    expect(error.message).toBe(
      "문서 파일이 손상되어 읽을 수 없습니다. (스트림 없음)",
    );
  });
});

describe("toHwpConversionError — rhwp 문자열 오류 분류", () => {
  const cases: Array<[string, string]> = [
    [
      "유효하지 않은 파일: 지원하지 않는 포맷입니다: 빈 파일. 오류코드: EMPTY_FILE. 빈 파일(0 바이트)입니다.",
      "EMPTY",
    ],
    [
      "유효하지 않은 파일: 지원하지 않는 포맷입니다: 알 수 없는 파일 형식. 오류코드: UNSUPPORTED_FILE_FORMAT. 현재 rhwp는 HWP 5.0, HWPX, 일부 HWP 3.0, HWPML 2.9 문서를 지원합니다.",
      "UNSUPPORTED",
    ],
    [
      "유효하지 않은 파일: 지원하지 않는 포맷입니다: DRM 보호 문서 (SoftCamp SCDSA). 오류코드: DRM_PROTECTED. DRM/보안 컨테이너로 보호된 문서입니다.",
      "DRM_PROTECTED",
    ],
    [
      "유효하지 않은 파일: 비밀번호가 필요한 암호 문서입니다 (parse_document_with_password 또는 parse_hwp_with_password 로 비밀번호를 전달하세요)",
      "ENCRYPTED",
    ],
    [
      "암호 오류: 비밀번호가 일치하지 않거나 암호화 데이터가 손상되었습니다",
      "ENCRYPTED",
    ],
    [
      "유효하지 않은 파일: HML 오류: 지원하지 않는 HWPML 버전입니다: 2.8",
      "HWPML_VERSION",
    ],
    ["유효하지 않은 파일: CFB 오류: 스트림 없음: FileHeader", "CORRUPTED"],
    [
      "유효하지 않은 파일: HWP 3.0 오류: 입출력 오류가 발생했습니다: failed to fill whole buffer",
      "CORRUPTED",
    ],
    ["유효하지 않은 파일: HML 오류: HML HEAD 요소가 없습니다", "CORRUPTED"],
    [
      "유효하지 않은 파일: DocInfo 오류: DocInfo 레코드 오류: 레코드 데이터 부족",
      "CORRUPTED",
    ],
    ["렌더링 오류: XML 쓰기 실패: 미등록 ID 참조 발견", "CONVERSION_FAILED"],
    ["전혀 새로운 오류", "CONVERSION_FAILED"],
  ];

  it.each(cases)("%s → %s", (raw, code) => {
    const error = toHwpConversionError(raw);

    expect(error).toBeInstanceOf(HwpConversionError);
    expect(error.code).toBe(code);
  });

  it("엔진 이름·내부 API 이름을 사용자 메시지에 흘리지 않는다", () => {
    for (const [raw] of cases) {
      const { message } = toHwpConversionError(raw);

      expect(message).not.toMatch(/rhwp|parse_|_with_password|오류코드/);
      expect(message).not.toContain("유효하지 않은 파일: ");
    }
  });

  it("버전 오류에는 문서 버전을 알려준다", () => {
    const error = toHwpConversionError(
      "유효하지 않은 파일: HML 오류: 지원하지 않는 HWPML 버전입니다: 2.8",
    );

    expect(error.message).toContain("문서 버전: 2.8");
  });

  it("손상 오류에는 어느 영역이 손상됐는지(영역 이름)만 붙인다", () => {
    const error = toHwpConversionError(
      "유효하지 않은 파일: CFB 오류: 스트림 없음: FileHeader",
    );

    expect(error.message).toBe(
      "문서 파일이 손상되어 읽을 수 없습니다. (CFB 오류)",
    );
  });

  it.each([
    [
      "유효하지 않은 파일: HWP 3.0 오류: 입출력 오류가 발생했습니다: failed to fill whole buffer",
      "HWP 3.0 오류",
    ],
    [
      "유효하지 않은 파일: CFB 오류: 압축 해제 실패: corrupt deflate stream",
      "CFB 오류",
    ],
    [
      "유효하지 않은 파일: HML 오류: 잘못된 HML XML입니다: syntax error: tag not closed",
      "HML 오류",
    ],
  ])("손상 오류에 엔진의 영어 문구를 싣지 않는다: %s", (raw, label) => {
    const error = toHwpConversionError(raw);

    expect(error.code).toBe("CORRUPTED");
    expect(error.message).toBe(
      `문서 파일이 손상되어 읽을 수 없습니다. (${label})`,
    );
  });
});

describe("toHwpConversionError — 문자열이 아닌 값", () => {
  it("이미 HwpConversionError 면 그대로 둔다", () => {
    const original = new HwpConversionError("TOO_LARGE");

    expect(toHwpConversionError(original)).toBe(original);
  });

  it("WASM 트랩(RuntimeError)은 영어 문구 없이 한국어로", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");

    const error = toHwpConversionError(trap);

    expect(error.code).toBe("CONVERSION_FAILED");
    expect(error.message).not.toMatch(/unreachable/);
    expect(error.message).toMatch(/엔진 내부 오류/);
  });

  it("그 밖의 Error·임의 값도 한국어 일반 실패", () => {
    for (const value of [
      new Error("null pointer passed to rust"),
      undefined,
      42,
    ]) {
      const error = toHwpConversionError(value);

      expect(error.code).toBe("CONVERSION_FAILED");
      expect(error.message).toBe("문서 변환에 실패했습니다.");
    }
  });
});

describe("sanitizeDetail", () => {
  it("접두어를 떼고, 내부 정보가 섞인 문구는 버린다", () => {
    expect(sanitizeDetail("유효하지 않은 파일: CFB 오류: x")).toBe(
      "CFB 오류: x",
    );
    expect(sanitizeDetail("현재 rhwp는 …")).toBeUndefined();
    expect(sanitizeDetail("parse_hwp_with_password 로")).toBeUndefined();
    expect(sanitizeDetail("   ")).toBeUndefined();
  });
});
