import { describe, expect, it } from "vitest";
import { parseContentDispositionFilename } from "../src/fetch/content-disposition.js";

describe("parseContentDispositionFilename", () => {
  it("returns null for empty header", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename(undefined)).toBeNull();
    expect(parseContentDispositionFilename("")).toBeNull();
  });

  it("returns null when no filename field present", () => {
    expect(parseContentDispositionFilename("attachment")).toBeNull();
    expect(parseContentDispositionFilename("inline")).toBeNull();
  });

  it("parses quoted filename", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="report.pdf"'),
    ).toBe("report.pdf");
  });

  it("parses unquoted filename", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=report.pdf"),
    ).toBe("report.pdf");
  });

  it("parses quoted filename with Korean characters", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="한국장학재단_복권기금 꿈사다리 장학사업 발전방향 연구.hwpx"',
      ),
    ).toBe("한국장학재단_복권기금 꿈사다리 장학사업 발전방향 연구.hwpx");
  });

  it("parses RFC 5987 filename* (UTF-8 percent-encoded)", () => {
    const header =
      "attachment; filename*=UTF-8''%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C.hwpx";
    expect(parseContentDispositionFilename(header)).toBe("한글문서.hwpx");
  });

  it("prefers filename* over filename when both present", () => {
    const header =
      "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''actual.hwpx";
    expect(parseContentDispositionFilename(header)).toBe("actual.hwpx");
  });

  it("replaces path separators to prevent traversal", () => {
    // slashes → _, dots preserved (legitimate in filenames). basename 은 경로가 아닌 파일 이름만.
    const result = parseContentDispositionFilename(
      'attachment; filename="../../etc/passwd"',
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("strips control characters", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="bad\r\nname.pdf"'),
    ).toBe("badname.pdf");
  });

  it("falls back to unquoted parser when closing quote missing (may include leading quote)", () => {
    const result = parseContentDispositionFilename(
      'attachment; filename="unterminated',
    );
    expect(result).not.toBeNull();
    // Edge case: malformed header. Best-effort — caller can further sanitize if needed.
  });

  it("handles extra whitespace around =", () => {
    expect(
      parseContentDispositionFilename('attachment; filename   =   "x.pdf"'),
    ).toBe("x.pdf");
  });

  it("handles real data.go.kr header", () => {
    const header =
      'attachment; filename="한국장학재단_복권기금 꿈사다리 장학사업 발전방향 연구.hwpx"';
    const name = parseContentDispositionFilename(header);
    expect(name).not.toBeNull();
    expect(name).toMatch(/\.hwpx$/);
  });

  it("recovers UTF-8 filename mojibake (Fetch latin-1 header ByteString)", () => {
    // Fetch 스펙은 헤더를 ISO-8859-1 로 디코드 — UTF-8 바이트가 그대로 담긴 구식 헤더는
    // "한국장학재단..hwpx" 의 UTF-8 바이트가 각각 latin-1 codepoint 로 해석된 상태로 도착.
    // 우리 파서는 이를 감지해 UTF-8 로 재디코드한다.
    const utf8Bytes = Buffer.from("한국장학재단.hwpx", "utf-8");
    const mojibake = utf8Bytes.toString("latin1");
    const header = `attachment; filename="${mojibake}"`;
    const name = parseContentDispositionFilename(header);
    expect(name).toBe("한국장학재단.hwpx");
  });

  it("leaves pure ASCII filename unchanged", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="plain.pdf"'),
    ).toBe("plain.pdf");
  });

  it("leaves already-unicode filename unchanged (no double-decode)", () => {
    // 제대로 된 UTF-8 JS 문자열이 들어오면 건드리지 않는다 (data.go.kr 재디코드 케이스의 역).
    // 한글이 codepoint > 0xFF 이므로 무조건 원본 유지.
    expect(
      parseContentDispositionFilename('attachment; filename="정상한글.pdf"'),
    ).toBe("정상한글.pdf");
  });
});
