import { describe, expect, it } from "vitest";
import {
  dedupeOverlappingRuns,
  mergeAdjacentRuns,
  type PdfTextRun,
} from "../src/parsers/pdf-text-runs.js";

/** 테스트용 런 생성 — 지정하지 않은 값은 기본값 사용 */
function run(overrides: Partial<PdfTextRun> & { text: string }): PdfTextRun {
  return {
    x: 0,
    y: 0,
    width: overrides.text.length * 10,
    height: 10,
    font: "f1",
    ...overrides,
  };
}

describe("dedupeOverlappingRuns", () => {
  it("미세 오프셋으로 겹쳐 그린 같은 글자를 하나만 남긴다", () => {
    // Arrange — 한글 워드프로세서가 굵게를 흉내내는 방식 (0.1pt씩 밀어 반복 그리기)
    const runs = Array.from({ length: 23 }, (_, i) =>
      run({
        text: "제안요청서",
        x: 219 + i * 0.06,
        y: 569 - i * 0.06,
        height: 32,
      }),
    );

    // Act
    const kept = dedupeOverlappingRuns(runs);

    // Assert
    expect(kept).toHaveLength(1);
    expect(kept[0]?.x).toBe(219);
  });

  it("같은 글자라도 서로 다른 줄에 있으면 남긴다", () => {
    // Arrange — 줄 간격만큼 떨어진 두 줄
    const runs = [run({ text: "개통", y: 200 }), run({ text: "개통", y: 186 })];

    // Act & Assert
    expect(dedupeOverlappingRuns(runs)).toHaveLength(2);
  });

  it("같은 글자라도 가로로 떨어져 있으면 남긴다 (표의 반복 셀)", () => {
    // Arrange
    const runs = [run({ text: "보유", x: 100 }), run({ text: "보유", x: 300 })];

    // Act & Assert
    expect(dedupeOverlappingRuns(runs)).toHaveLength(2);
  });

  it("글꼴이 다르면 겹쳐 있어도 남긴다", () => {
    // Arrange
    const runs = [
      run({ text: "합계", font: "f1" }),
      run({ text: "합계", font: "f2" }),
    ];

    // Act & Assert
    expect(dedupeOverlappingRuns(runs)).toHaveLength(2);
  });

  it("높이가 0인 공백 런도 절대 하한 허용오차로 중복을 걸러낸다", () => {
    // Arrange — 공백 글리프는 height 가 0이라 비율 기반 허용오차가 0이 된다
    const runs = [
      run({ text: " ", x: 145, y: 610, width: 0.5, height: 0 }),
      run({ text: " ", x: 143, y: 612, width: 0.5, height: 0 }),
    ];

    // Act & Assert
    expect(dedupeOverlappingRuns(runs)).toHaveLength(1);
  });

  it("입력 배열을 변경하지 않는다", () => {
    // Arrange
    const runs = [run({ text: "가" }), run({ text: "가" })];

    // Act
    dedupeOverlappingRuns(runs);

    // Assert
    expect(runs).toHaveLength(2);
  });
});

describe("mergeAdjacentRuns", () => {
  it("시각적 간격 없이 이어지는 런을 하나로 합친다", () => {
    // Arrange — `제21조` 가 제 / 21 / 조 세 런으로 쪼개져 있는 상황
    const runs = [
      run({ text: "제", x: 184, width: 14 }),
      run({ text: "21", x: 198, width: 14 }),
      run({ text: "조", x: 212, width: 14 }),
    ];

    // Act
    const merged = mergeAdjacentRuns(runs);

    // Assert
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("제21조");
    expect(merged[0]?.x).toBe(184);
    expect(merged[0]?.width).toBe(42);
  });

  it("사이에 공백 런이 있으면 합치지 않는다 (실제 띄어쓰기 보존)", () => {
    // Arrange — 공백 글리프는 height 가 0이라 경계 역할을 한다
    const runs = [
      run({ text: "년", x: 121, width: 24, height: 24 }),
      run({ text: " ", x: 145, width: 0.5, height: 0 }),
      run({ text: "디지털", x: 157, width: 72, height: 24 }),
    ];

    // Act & Assert
    expect(mergeAdjacentRuns(runs).map((r) => r.text)).toEqual([
      "년",
      " ",
      "디지털",
    ]);
  });

  it("눈에 보이는 간격이 있으면 합치지 않는다 (표의 다른 칸)", () => {
    // Arrange
    const runs = [
      run({ text: "구분", x: 72, width: 34 }),
      run({ text: "기대효과", x: 298, width: 68 }),
    ];

    // Act & Assert
    expect(mergeAdjacentRuns(runs)).toHaveLength(2);
  });

  it("글꼴이나 크기가 다르면 합치지 않는다", () => {
    // Arrange
    const runs = [
      run({ text: "본문", x: 0, width: 20, font: "f1" }),
      run({ text: "각주", x: 20, width: 20, font: "f2" }),
      run({ text: "큰글", x: 40, width: 20, font: "f2", height: 20 }),
    ];

    // Act & Assert
    expect(mergeAdjacentRuns(runs)).toHaveLength(3);
  });

  it("줄이 다르면 합치지 않는다", () => {
    // Arrange
    const runs = [
      run({ text: "끝", x: 500, width: 10, y: 200 }),
      run({ text: "처음", x: 510, width: 20, y: 186 }),
    ];

    // Act & Assert
    expect(mergeAdjacentRuns(runs)).toHaveLength(2);
  });

  it("입력 배열과 원소를 변경하지 않는다", () => {
    // Arrange
    const first = run({ text: "제", x: 0, width: 10 });
    const runs = [first, run({ text: "1", x: 10, width: 10 })];

    // Act
    mergeAdjacentRuns(runs);

    // Assert
    expect(runs).toHaveLength(2);
    expect(first.text).toBe("제");
  });

  it("원소의 프로토타입을 보존한다", () => {
    // Arrange — pdf2md 는 TextItem 클래스 인스턴스를 넘겨준다
    class TextItem {
      constructor(readonly props: PdfTextRun) {
        Object.assign(this, props);
      }
    }
    const runs = [
      new TextItem(
        run({ text: "제", x: 0, width: 10 }),
      ) as unknown as PdfTextRun,
      new TextItem(
        run({ text: "1", x: 10, width: 10 }),
      ) as unknown as PdfTextRun,
    ];

    // Act
    const merged = mergeAdjacentRuns(runs);

    // Assert
    expect(merged[0]).toBeInstanceOf(TextItem);
  });
});
