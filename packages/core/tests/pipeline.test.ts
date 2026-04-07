import { describe, expect, it } from "vitest";
import { convert } from "../src/pipeline.js";

describe("convert", () => {
  it("지원하지 않는 확장자는 에러를 던진다", async () => {
    await expect(convert({ inputPath: "test.txt" })).rejects.toThrow(
      "지원하지 않는 파일 형식입니다",
    );
  });

  it(".hwpx 확장자를 올바르게 감지한다", async () => {
    await expect(convert({ inputPath: "test.hwpx" })).rejects.toThrow(
      "HWPX 변환은 아직 구현되지 않았습니다",
    );
  });

  it(".docx 확장자를 올바르게 감지한다", async () => {
    await expect(convert({ inputPath: "test.docx" })).rejects.toThrow(
      "DOCX 변환은 아직 구현되지 않았습니다",
    );
  });

  it(".pdf 확장자를 올바르게 감지한다", async () => {
    await expect(convert({ inputPath: "test.pdf" })).rejects.toThrow(
      "PDF 변환은 아직 구현되지 않았습니다",
    );
  });

  it("대소문자 구분 없이 확장자를 인식한다", async () => {
    await expect(convert({ inputPath: "test.DOCX" })).rejects.toThrow(
      "DOCX 변환은 아직 구현되지 않았습니다",
    );
  });
});
