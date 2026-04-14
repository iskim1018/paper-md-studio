import { describe, expect, it } from "vitest";
import { removeEmptyTableRows } from "../src/lib/md-cleanup";

describe("removeEmptyTableRows", () => {
  it("내용이 있는 테이블은 그대로 둔다", () => {
    const md = `| A | B |
| --- | --- |
| 1 | 2 |`;
    expect(removeEmptyTableRows(md)).toBe(md);
  });

  it("모든 셀이 공백인 row를 제거한다", () => {
    const md = `| A | B |
| --- | --- |
|   |   |
| 1 | 2 |`;
    expect(removeEmptyTableRows(md)).toBe(`| A | B |
| --- | --- |
| 1 | 2 |`);
  });

  it("헤더 구분선(---)은 제거하지 않는다", () => {
    const md = `| H |
| --- |
| a |`;
    expect(removeEmptyTableRows(md)).toBe(md);
  });

  it("강조/공백만 있는 셀도 빈 row로 인식한다", () => {
    const md = `| A |
| --- |
| **  ** |
| x |`;
    expect(removeEmptyTableRows(md)).toBe(`| A |
| --- |
| x |`);
  });

  it("연속된 빈 row를 모두 제거한다", () => {
    const md = `| A | B |
| --- | --- |
|  |  |
|  |  |
| 1 | 2 |
|  |  |
| 3 | 4 |`;
    expect(removeEmptyTableRows(md)).toBe(`| A | B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |`);
  });

  it("여러 테이블이 섞여 있어도 각각 처리한다", () => {
    const md = `| A |
| --- |
|  |
| x |

일반 문단

| C | D |
| --- | --- |
|  |  |
| 1 | 2 |`;
    expect(removeEmptyTableRows(md)).toBe(`| A |
| --- |
| x |

일반 문단

| C | D |
| --- | --- |
| 1 | 2 |`);
  });

  it("코드 펜스 내부의 표 모양은 건드리지 않는다", () => {
    const md = `\`\`\`
| A | B |
| --- | --- |
|  |  |
\`\`\``;
    expect(removeEmptyTableRows(md)).toBe(md);
  });

  it("테이블 외 일반 파이프 라인은 건드리지 않는다", () => {
    const md = "| 이것은 | 그냥 | 문장";
    // "|"로 끝나지 않으므로 테이블 row 아님
    expect(removeEmptyTableRows(md)).toBe(md);
  });

  it("<br>만 있는 셀도 빈 row로 인식한다", () => {
    const md = `| A |
| --- |
| <br> |
| x |`;
    expect(removeEmptyTableRows(md)).toBe(`| A |
| --- |
| x |`);
  });

  it("헤더 row가 비어있어도 구분선 앞에 있으면 보존한다 (테이블 구조 유지)", () => {
    // 사용자 리포트: 빈 헤더까지 제거하면 '| --- |'만 남아 뷰어에서
    // 테이블로 인식하지 못함. 구분선 바로 앞 row는 헤더이므로 보존해야 함.
    const md = `|  |
| --- |
| **샘플 문서 제목** 부제목 |
|  |`;
    expect(removeEmptyTableRows(md)).toBe(`|  |
| --- |
| **샘플 문서 제목** 부제목 |`);
  });

  it("빈 헤더 + 구분선 + 빈 body만 있는 테이블도 헤더를 보존한다", () => {
    const md = `|  |  |
| --- | --- |
|  |  |`;
    // 헤더는 유지, body의 빈 row만 제거
    expect(removeEmptyTableRows(md)).toBe(`|  |  |
| --- | --- |`);
  });
});
