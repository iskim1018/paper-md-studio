/**
 * @rhwp/core API 계약 테스트.
 *
 * 다른 테스트와 달리 `@rhwp/core`를 **모킹하지 않고** 실제 패키지를 불러와
 * 우리가 의존하는 메서드가 실제로 존재하는지 검증한다. rhwp는 릴리스 주기가
 * 짧아 버전을 올릴 때 API가 사라지거나 이름이 바뀌면 런타임에서야 드러나는데,
 * 이 테스트가 그 시점을 빌드 단계로 앞당긴다.
 *
 * WASM 초기화 없이 프로토타입만 확인하므로 빠르고 환경 의존이 없다.
 */
import { HwpDocument } from "@rhwp/core";
import { describe, expect, it } from "vitest";

/** HWPX 뷰어(hwpx-viewer.tsx, hwpx-text-index.ts, use-hwpx-search.ts)가 호출하는 API */
const VIEWER_METHODS = [
  "free",
  "getCellParagraphCountByPath",
  "getCellParagraphLengthByPath",
  "getControlTextPositions",
  "getPageInfo",
  "getParagraphCount",
  "getParagraphLength",
  "getSectionCount",
  "getSelectionRects",
  "getSelectionRectsInCell",
  "getTableCellBboxesByPath",
  "getTableDimensionsByPath",
  "getTextInCellByPath",
  "getTextRange",
  "pageCount",
  "renderPageSvg",
] as const;

/** MD → HWPX 변환기(core/hwpx-writer)가 호출하는 문서 조립·저장 API */
const WRITER_METHODS = [
  "applyCharFormat",
  "applyParaFormat",
  "applyStyle",
  "createBlankDocument",
  "createStyle",
  "createTable",
  "ensureDefaultBullet",
  "ensureDefaultNumbering",
  "exportHwpx",
  "findOrCreateFontId",
  "insertFootnote",
  "insertPicture",
  "insertText",
  "insertTextInCell",
  "insertTextInFootnote",
  "setCellProperties",
  "setPageDef",
  "splitParagraph",
] as const;

function hasMethod(name: string): boolean {
  return (
    typeof (HwpDocument.prototype as unknown as Record<string, unknown>)[
      name
    ] === "function"
  );
}

describe("@rhwp/core API 계약", () => {
  it.each(VIEWER_METHODS)("뷰어가 쓰는 %s 가 존재한다", (method) => {
    expect(hasMethod(method)).toBe(true);
  });

  it.each(WRITER_METHODS)("변환기가 쓰는 %s 가 존재한다", (method) => {
    expect(hasMethod(method)).toBe(true);
  });

  it("정적 팩토리 createEmpty 가 존재한다", () => {
    expect(typeof HwpDocument.createEmpty).toBe("function");
  });
});
