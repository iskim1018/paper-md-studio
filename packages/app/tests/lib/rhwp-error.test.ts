import { describe, expect, it } from "vitest";
import { describeRhwpError } from "../../src/lib/rhwp-error";

describe("describeRhwpError", () => {
  it("rhwp 가 문자열로 던진 암호 문서 오류를 개발자용 안내 없이 풀어 쓴다", () => {
    // Arrange — rhwp 0.8.6 이 실제로 던지는 문자열 모양
    const thrown =
      "유효하지 않은 파일: 비밀번호가 필요한 암호 문서입니다 (parse_document_with_password 또는 parse_hwp_with_password 로 비밀번호를 전달하세요)";

    // Act
    const message = describeRhwpError(thrown);

    // Assert
    expect(message).toContain("암호로 보호된 문서");
    expect(message).not.toContain("parse_");
  });

  it("DRM·빈 파일·미지원 형식을 구분한다", () => {
    expect(
      describeRhwpError("유효하지 않은 파일: 오류코드: DRM_PROTECTED. …"),
    ).toContain("DRM");
    expect(
      describeRhwpError("유효하지 않은 파일: 빈 파일. 오류코드: EMPTY_FILE"),
    ).toBe("빈 파일입니다.");
    expect(
      describeRhwpError(
        "유효하지 않은 파일: 알 수 없는 파일 형식. 오류코드: UNSUPPORTED_FILE_FORMAT. 현재 rhwp는 …",
      ),
    ).toBe("한글 문서가 아니거나 지원하지 않는 형식입니다.");
  });

  it("그 밖의 문자열은 앞머리만 떼고 보여준다", () => {
    expect(
      describeRhwpError(
        "유효하지 않은 파일: CFB 오류: 스트림 없음: FileHeader",
      ),
    ).toBe("CFB 오류: 스트림 없음: FileHeader");
  });

  it("Error 와 알 수 없는 값도 처리한다", () => {
    expect(describeRhwpError(new Error("읽기 실패"))).toBe("읽기 실패");
    expect(describeRhwpError(undefined)).toBe("알 수 없는 오류");
    expect(describeRhwpError(42)).toBe("알 수 없는 오류");
  });
});
