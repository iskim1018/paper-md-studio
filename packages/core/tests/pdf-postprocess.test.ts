import { describe, expect, it } from "vitest";
import {
  cleanupPdfMarkdown,
  hasExtractableText,
} from "../src/parsers/pdf-postprocess.js";

describe("hasExtractableText", () => {
  it("페이지 구분 주석만 남으면 텍스트가 없다고 본다 (스캔본)", () => {
    // Arrange — 텍스트 레이어가 없는 PDF 의 변환 결과
    const markdown = "\n\n<!-- PAGE_BREAK -->\n\n<!-- PAGE_BREAK -->\n";

    // Act & Assert
    expect(hasExtractableText(markdown)).toBe(false);
  });

  it("빈 문자열은 텍스트가 없다고 본다", () => {
    expect(hasExtractableText("")).toBe(false);
  });

  it("본문이 한 글자라도 있으면 텍스트가 있다고 본다", () => {
    // Arrange
    const markdown = "<!-- PAGE_BREAK -->\n\n사업 추진 계획서\n";

    // Act & Assert
    expect(hasExtractableText(markdown)).toBe(true);
  });
});

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

  it("문장으로 끝나는 제목 줄은 본문으로 되돌린다", () => {
    // Arrange — 표가 많은 문서에서는 표 셀 크기가 최빈값이 되어
    // 본문(11pt)이 제목으로 승격된다
    const input = "## 다음과 같이 사업 추진 계획을 제출합니다.";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(
      "다음과 같이 사업 추진 계획을 제출합니다.",
    );
  });

  // 트레이드오프: 본문 없이 같은 단계 제목만 나열된 문서(부록 목록 등)는 표 행과
  // 구분할 수단이 없어 함께 강등된다. 마커만 사라지고 글자는 남으므로 손실은 없다.
  it("같은 단계 제목이 연달아 3개 이상이면 본문으로 되돌린다 (표 행 오인식)", () => {
    // Arrange — 표의 각 행이 제목으로 잡힌 상황
    const input = [
      "### 구분 사업명 예산(천원)",
      "",
      "### 1분기 노후 상수관 교체 1,250,000",
      "",
      "### 2분기 공원 정비 430,000",
    ].join("\n");

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(
      [
        "구분 사업명 예산(천원)",
        "",
        "1분기 노후 상수관 교체 1,250,000",
        "",
        "2분기 공원 정비 430,000",
      ].join("\n"),
    );
  });

  it("물음표로 끝나는 제목은 그대로 둔다 (FAQ 형식 제목)", () => {
    // Arrange — 물음표는 문장 종결로 보지 않는다. 물음표로 끝나는 본문(시험지
    // 문항 등)은 연속 규칙이 잡으므로 제목을 희생할 이유가 없다
    const input = "## 제출 기한은 언제인가요?";

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(input);
  });

  it("본문 사이에 놓인 제목은 그대로 둔다", () => {
    // Arrange — 진짜 제목은 본문에 의해 서로 떨어져 있다
    const input = [
      "## 추진 배경",
      "",
      "인구 감소가 지속되고 있다.",
      "",
      "## 추진 계획",
      "",
      "3개년에 걸쳐 시행한다.",
    ].join("\n");

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(input);
  });

  it("단계가 다르면 연속 제목으로 세지 않는다", () => {
    // Arrange — 장/절/항 위계는 연달아 나오는 것이 정상이다
    const input = ["# 제1장 총칙", "", "## 제1절 목적", "", "### 1. 정의"].join(
      "\n",
    );

    // Act & Assert
    expect(cleanupPdfMarkdown(input)).toBe(input);
  });

  it("빈 문자열을 그대로 반환한다", () => {
    // Arrange & Act & Assert
    expect(cleanupPdfMarkdown("")).toBe("");
  });
});
