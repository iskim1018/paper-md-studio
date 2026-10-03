import { describe, expect, it } from "vitest";
import { contentLossToWarnings } from "../src/parsers/hwp/content-loss.js";

function report(losses: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    schemaVersion: 1,
    outputFormat: "hwpx",
    count: losses.length,
    losses,
  });
}

describe("contentLossToWarnings", () => {
  it("손실이 없으면 경고도 없다", () => {
    expect(contentLossToWarnings(report([]))).toEqual([]);
  });

  it("같은 종류·원인의 손실은 개수로 묶어 한 줄로 알린다", () => {
    // Arrange
    const loss = {
      code: "binaryContentEmptied",
      subject: "binaryData",
      path: "BinData/BIN0001.png",
      reason: "resourceReadFailedOrLimitExceeded",
      resourceId: 1,
    };

    // Act
    const warnings = contentLossToWarnings(
      report([loss, { ...loss, resourceId: 2 }]),
    );

    // Assert
    expect(warnings).toEqual([
      "이미지 등 첨부 데이터 2개를 읽지 못해 빈 내용으로 변환했습니다 (읽기 실패 또는 크기 상한 초과).",
    ]);
  });

  it("코드마다 다른 문장으로 알리고 경로·ID 같은 내부 정보는 싣지 않는다", () => {
    const warnings = contentLossToWarnings(
      report([
        {
          code: "controlOmitted",
          subject: "control",
          path: "section0/p3/ctrl1",
          reason: "unsupportedByOutputFormat",
        },
        {
          code: "metadataReduced",
          subject: "fieldParameters",
          path: "section0/p5/field",
          reason: "unsupportedByOutputFormat",
        },
      ]),
    );

    expect(warnings).toEqual([
      "변환 형식에 담을 수 없는 개체 1개가 빠졌습니다 (대응 표현 없음).",
      "필드 정보 1건이 일부 축소되었습니다 (대응 표현 없음).",
    ]);
    expect(warnings.join("")).not.toMatch(/section0|BinData/);
  });

  it("모르는 코드·원인도 조용히 버리지 않는다", () => {
    const warnings = contentLossToWarnings(
      report([{ code: "somethingNew", subject: "x", path: "p", reason: "y" }]),
    );

    expect(warnings).toEqual([
      "변환 중 일부 내용 1건이 빠졌을 수 있습니다 (원인 미상).",
    ]);
  });

  it("보고서를 해석할 수 없으면 그 사실을 경고로 남긴다", () => {
    for (const raw of ["not json", "null", '{"losses":"x"}']) {
      expect(contentLossToWarnings(raw)).toEqual([
        "변환 손실 보고서를 해석하지 못했습니다. 일부 내용이 빠졌을 수 있습니다.",
      ]);
    }
  });
});
