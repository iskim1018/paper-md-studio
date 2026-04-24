import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInput } from "../src/input-resolver.js";

describe("resolveInput", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "paper-md-mcp-resolver-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("reads a file via path and normalizes name", async () => {
    const filePath = join(workDir, "hello.docx");
    await writeFile(filePath, Buffer.from([1, 2, 3, 4]));
    const result = await resolveInput({ path: filePath }, { maxUploadMb: 10 });
    expect(result.source).toBe("path");
    expect(result.bytes.byteLength).toBe(4);
    expect(result.originalName).toBe("hello.docx");
  });

  it("decodes base64 input", async () => {
    const bytes = Buffer.from("hello world");
    const result = await resolveInput(
      {
        base64: bytes.toString("base64"),
        filename: "note.txt",
        mime: "text/plain",
      },
      { maxUploadMb: 10 },
    );
    expect(result.source).toBe("base64");
    expect(Buffer.from(result.bytes).toString("utf-8")).toBe("hello world");
    expect(result.originalName).toBe("note.txt");
    expect(result.mime).toBe("text/plain");
  });

  it("rejects oversized path", async () => {
    const filePath = join(workDir, "big.bin");
    await writeFile(filePath, Buffer.alloc(2048));
    await expect(
      resolveInput({ path: filePath }, { maxUploadMb: 0.001 }),
    ).rejects.toThrow(/한도/);
  });

  it("rejects empty base64", async () => {
    await expect(
      resolveInput({ base64: "" }, { maxUploadMb: 1 }),
    ).rejects.toThrow(/지정/);
  });

  it("throws when no input provided", async () => {
    await expect(resolveInput({}, { maxUploadMb: 1 })).rejects.toThrow(
      /하나는 반드시/,
    );
  });

  it("downloads via fetch stub", async () => {
    const stub: typeof fetch = async () =>
      new Response(new Uint8Array([9, 9, 9]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const result = await resolveInput(
      { url: "https://example.com/file.pdf" },
      { maxUploadMb: 10, fetchImpl: stub },
    );
    expect(result.source).toBe("url");
    expect(result.bytes.byteLength).toBe(3);
    expect(result.originalName).toBe("file.pdf");
    expect(result.mime).toBe("application/pdf");
  });

  it("uses Content-Disposition filename when URL path lacks extension", async () => {
    // Response 헤더는 ByteString 이라 RFC 5987 filename* (percent-encoded) 로 전달
    const encoded =
      "%ED%95%9C%EA%B5%AD%EC%9E%A5%ED%95%99%EC%9E%AC%EB%8B%A8_%EB%B3%B5%EA%B6%8C%EA%B8%B0%EA%B8%88%20%EA%BF%88%EC%82%AC%EB%8B%A4%EB%A6%AC%20%EC%9E%A5%ED%95%99%EC%82%AC%EC%97%85%20%EB%B0%9C%EC%A0%84%EB%B0%A9%ED%96%A5%20%EC%97%B0%EA%B5%AC.hwpx";
    const stub: typeof fetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${encoded}`,
        },
      });
    const result = await resolveInput(
      {
        url: "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE",
      },
      { maxUploadMb: 10, fetchImpl: stub },
    );
    expect(result.source).toBe("url");
    expect(result.originalName).toMatch(/\.hwpx$/);
    expect(result.originalName).toContain("한국장학재단");
  });

  it("filename hint takes precedence over Content-Disposition", async () => {
    const stub: typeof fetch = async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="cd-name.docx"',
        },
      });
    const result = await resolveInput(
      {
        url: "https://example.com/dl",
        filename: "override.hwpx",
      },
      { maxUploadMb: 10, fetchImpl: stub },
    );
    expect(result.originalName).toBe("override.hwpx");
  });
});
