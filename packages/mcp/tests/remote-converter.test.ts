import { describe, expect, it, vi } from "vitest";
import { RemoteConverter } from "../src/converters/remote.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

describe("RemoteConverter.convert", () => {
  it("sends multipart POST to /v1/convert?images=refs", async () => {
    const fetchImpl = vi.fn(async (_url, _init) =>
      jsonResponse({
        success: true,
        data: {
          conversionId: "a".repeat(64),
          format: "pdf",
          markdown: "# Hello",
          images: [],
          cached: false,
          elapsedMs: 12,
          createdAt: "2026-04-24T00:00:00Z",
          originalName: "sample.pdf",
          size: 4,
        },
      }),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });

    const output = await remote.convert({
      bytes: new Uint8Array([1, 2, 3, 4]),
      originalName: "sample.pdf",
    });

    expect(output.conversionId).toBe("a".repeat(64));
    expect(output.format).toBe("pdf");
    expect(output.markdown).toBe("# Hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "http://localhost:3000/v1/convert?images=refs",
    );
    const init = calledInit as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toMatch(/multipart\/form-data; boundary=/);
  });

  it("sends X-API-Key header when configured", async () => {
    const fetchImpl = vi.fn(async (_url, _init) =>
      jsonResponse({
        success: true,
        data: {
          conversionId: "b".repeat(64),
          format: "docx",
          markdown: "",
          images: [],
          cached: false,
          elapsedMs: 0,
          createdAt: "2026-04-24T00:00:00Z",
          originalName: "x.docx",
          size: 0,
        },
      }),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      apiKey: "secret-key",
      fetchImpl,
    });
    await remote.convert({
      bytes: new Uint8Array([0]),
      originalName: "x.docx",
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("secret-key");
  });

  it("throws on 4xx envelope error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { success: false, error: "지원하지 않는 형식" },
        { status: 400 },
      ),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });
    await expect(
      remote.convert({ bytes: new Uint8Array([1]), originalName: "x.txt" }),
    ).rejects.toThrow(/지원하지 않는 형식/);
  });

  it("throws on non-JSON response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>Gateway Timeout</html>", {
          status: 504,
          headers: { "content-type": "text/html" },
        }),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });
    await expect(
      remote.convert({ bytes: new Uint8Array([1]), originalName: "x.pdf" }),
    ).rejects.toThrow(/JSON 이 아닌/);
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetchImpl = vi.fn(async (_url, _init) =>
      jsonResponse({
        success: true,
        data: {
          conversionId: "c".repeat(64),
          format: "pdf",
          markdown: "",
          images: [],
          cached: false,
          elapsedMs: 0,
          createdAt: "2026-04-24T00:00:00Z",
          originalName: "x.pdf",
          size: 0,
        },
      }),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000/",
      fetchImpl,
    });
    await remote.convert({ bytes: new Uint8Array([0]), originalName: "x.pdf" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "http://localhost:3000/v1/convert?images=refs",
    );
  });
});

describe("RemoteConverter.getMarkdown", () => {
  it("returns markdown on 200", async () => {
    const fetchImpl = vi.fn(async (_url, _init) =>
      jsonResponse({
        success: true,
        data: {
          conversionId: "a".repeat(64),
          format: "pdf",
          markdown: "# From cache",
          images: [],
          cached: true,
          elapsedMs: 0,
          createdAt: "2026-04-24T00:00:00Z",
          originalName: null,
          size: 100,
        },
      }),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });
    const md = await remote.getMarkdown("a".repeat(64));
    expect(md).toBe("# From cache");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `http://localhost:3000/v1/conversions/${"a".repeat(64)}`,
    );
  });

  it("returns null on 404", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: "not found" }, { status: 404 }),
    );
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      fetchImpl,
    });
    expect(await remote.getMarkdown("z".repeat(64))).toBeNull();
  });
});

describe("RemoteConverter.getImage", () => {
  it("throws — inline 미지원 명시", async () => {
    const remote = new RemoteConverter({
      baseUrl: "http://localhost:3000",
      fetchImpl: vi.fn(),
    });
    await expect(remote.getImage("a".repeat(64), "img.png")).rejects.toThrow(
      /inline 이미지 모드를 지원하지 않습니다/,
    );
  });
});
