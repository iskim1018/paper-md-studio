import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convert, convertToHtml } from "../src/pipeline.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const SAMPLE = resolve(FIXTURES, "sample.html");

describe("HTML 변환 (convert)", () => {
  it("로컬 HTML 파일을 본문 위주 Markdown으로 변환한다", async () => {
    // Act
    const result = await convert({ inputPath: SAMPLE });

    // Assert
    expect(result.format).toBe("html");
    expect(result.markdown).toContain("문서 변환 도구의 본문 추출 원리");
    expect(result.markdown).toContain("Readability 계열의 휴리스틱");
    // 본문 외 요소 제거 확인
    expect(result.markdown).not.toContain("사이드바 인기글");
    expect(result.markdown).not.toContain("광고 배너");
    expect(result.markdown).not.toContain("저작권 안내");
    // 스크립트/스타일 제거 확인
    expect(result.markdown).not.toContain("추적 스크립트");
    expect(result.markdown).not.toContain("font-family");
  });

  it("문서 제목이 h1, 본문 제목이 h2 헤딩으로 포함된다", async () => {
    const result = await convert({ inputPath: SAMPLE });

    // Readability는 본문 h1을 h2로 강등하고, <title>은 별도 h1로 주입된다
    expect(result.markdown).toMatch(/^# 테스트 아티클/m);
    expect(result.markdown).toMatch(/^## .*본문 추출 원리/m);
  });

  it("extractContent=false면 페이지 전체를 변환한다", async () => {
    const result = await convert({
      inputPath: SAMPLE,
      html: { extractContent: false },
    });

    expect(result.markdown).toContain("사이드바 인기글");
    expect(result.markdown).toContain("저작권 안내");
    // 전체 변환이어도 스크립트는 제거
    expect(result.markdown).not.toContain("추적 스크립트");
  });

  it("baseUrl을 주면 상대 경로 이미지가 절대 경로로 바뀐다", async () => {
    const result = await convert({
      inputPath: SAMPLE,
      html: { baseUrl: "https://blog.example.com/post/" },
    });

    expect(result.markdown).toContain(
      "https://blog.example.com/post/images/diagram.png",
    );
  });

  it(".htm 확장자도 html 포맷으로 감지한다", async () => {
    // detectFormat이 .htm을 거부하지 않는지만 확인 (파일이 없어 ENOENT 예상)
    await expect(
      convert({ inputPath: "/없는파일/missing.htm" }),
    ).rejects.not.toThrow("지원하지 않는 파일 형식입니다");
  });

  it("로컬 파일에는 SPA 렌더링을 허용하지 않는다", async () => {
    await expect(
      convert({ inputPath: SAMPLE, html: { renderSpa: true } }),
    ).rejects.toThrow("URL 입력에서만");
  });

  it("http(s)가 아닌 baseUrl은 거부한다", async () => {
    await expect(
      convert({
        inputPath: SAMPLE,
        html: { baseUrl: "javascript:alert(1)" },
      }),
    ).rejects.toThrow("baseUrl은 http(s) URL이어야 합니다");
  });
});

describe("HTML 변환 (convertToHtml)", () => {
  it("뷰어용 HTML을 반환한다", async () => {
    const result = await convertToHtml({ inputPath: SAMPLE });

    expect(result.format).toBe("html");
    expect(result.html).toContain("본문과 부가 요소를");
    expect(result.html).not.toContain("<script");
  });
});
