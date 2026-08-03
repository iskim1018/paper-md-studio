import { describe, expect, it } from "vitest";
import { cleanupPdfMarkdown } from "../src/parsers/pdf-postprocess.js";

describe("cleanupPdfMarkdown", () => {
  it("점선 리더가 붙은 목차 줄을 목록 항목으로 바꾼다", () => {
    // Arrange — pdf2md 는 글자 크기만 보고 목차 줄을 제목으로 오인식한다
    const input = "#### Ⅰ. 사업 개요 ································ 1";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("- Ⅰ. 사업 개요 — 1");
  });

  it("제목 표기가 없는 목차 줄도 목록 항목으로 바꾼다", () => {
    // Arrange
    const input = "2. 배경 및 필요성 ·············· 3";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("- 2. 배경 및 필요성 — 3");
  });

  it("마침표를 리더로 쓴 목차 줄도 처리한다", () => {
    // Arrange
    const input = "###### 4. 기타 사항 ........... 60";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("- 4. 기타 사항 — 60");
  });

  it("제목 단계 차이를 들여쓰기로 옮겨 목차 계층을 보존한다", () => {
    // Arrange — 장은 ####, 절은 ###### 로 오인식되어 있다
    const input = [
      "#### Ⅰ. 사업 개요 ······· 1",
      "###### 1. 배경 ······· 1",
      "###### 2. 필요성 ······· 3",
      "#### Ⅱ. 제안요청 내용 ······· 11",
    ].join("\n");

    // Act & Assert — 가장 바깥 단계가 들여쓰기 0이 되어야 코드 블록으로 오인되지 않는다
    expect(cleanupPdfMarkdown(input)).toBe(
      [
        "- Ⅰ. 사업 개요 — 1",
        "  - 1. 배경 — 1",
        "  - 2. 필요성 — 3",
        "- Ⅱ. 제안요청 내용 — 11",
      ].join("\n"),
    );
  });

  it("점이 3개 이하면 목차로 보지 않는다", () => {
    // Arrange — 말줄임표가 들어간 평범한 문장
    const input = "## 그래서... 1";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("## 그래서... 1");
  });

  it("쪽 번호가 없으면 목차로 보지 않는다", () => {
    // Arrange
    const input = "## 구분 ··········································";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(
      "## 구분 ··········································",
    );
  });

  it("줄 끝 공백을 제거한다", () => {
    // Arrange
    const input = "본문 문장입니다.   \n다음 줄  ";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("본문 문장입니다.\n다음 줄");
  });

  it("줄 앞의 공백 한 칸을 제거한다", () => {
    // Arrange — pdf2md 는 문단마다 공백 한 칸을 앞에 붙인다
    const input = " 담당자 : 홍길동";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("담당자 : 홍길동");
  });

  it("두 칸 이상 들여쓴 줄은 그대로 둔다", () => {
    // Arrange — 목록 이어쓰기 등 의미 있는 들여쓰기
    const input = "    이어지는 목록 내용";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe("    이어지는 목록 내용");
  });

  it("페이지 구분 주석을 보존한다", () => {
    // Arrange
    const input = "앞 쪽\n\n<!-- PAGE_BREAK -->\n뒤 쪽";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(
      "앞 쪽\n\n<!-- PAGE_BREAK -->\n뒤 쪽",
    );
  });

  it("빈 문자열을 그대로 반환한다", () => {
    // Arrange & Act & Assert
    expect(cleanupPdfMarkdown("")).toBe("");
  });
});
