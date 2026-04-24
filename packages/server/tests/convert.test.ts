import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvertCache } from "../src/cache/index.js";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { LocalFsStorage, sha256Hex } from "../src/storage/index.js";

interface Part {
  readonly name: string;
  readonly filename?: string;
  readonly content: Buffer;
  readonly contentType?: string;
}

function makeMultipart(parts: ReadonlyArray<Part>): {
  payload: Buffer;
  contentType: string;
} {
  const boundary = `----paperformboundary${Math.random().toString(16).slice(2)}`;
  const chunks: Array<Buffer> = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) {
      header += `; filename="${part.filename}"`;
    }
    header += "\r\n";
    if (part.contentType) {
      header += `Content-Type: ${part.contentType}\r\n`;
    }
    header += "\r\n";
    chunks.push(
      Buffer.from(header, "utf-8"),
      part.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function makeTestConfig() {
  return loadConfig({
    SIGNING_SECRET: "test-secret-abcdefghijklmnop",
    LOG_LEVEL: "silent",
  });
}

describe("POST /v1/convert", () => {
  let storageRoot: string;
  let tmpRoot: string;
  let storage: LocalFsStorage;
  let convertImpl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-api-storage-"));
    tmpRoot = await mkdtemp(join(tmpdir(), "paper-md-api-tmp-"));
    storage = new LocalFsStorage({ root: storageRoot });
    convertImpl = vi.fn(
      async (_options: ConvertOptions): Promise<ConvertResult> => ({
        markdown: "# Hello\n\n본문",
        images: [],
        format: "docx",
        elapsed: 42,
      }),
    );
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(tmpRoot, { recursive: true, force: true });
  });

  async function buildTestApp() {
    const cache = new ConvertCache({
      storage,
      tmpDir: tmpRoot,
      convertImpl,
    });
    return buildServer({
      config: makeTestConfig(),
      convertCache: cache,
    });
  }

  it("멀티파트 파일 업로드를 변환해 200으로 markdown과 메타를 반환한다", async () => {
    const app = await buildTestApp();
    try {
      const bytes = Buffer.from([1, 2, 3, 4]);
      const sha = sha256Hex(new Uint8Array(bytes));
      const { payload, contentType } = makeMultipart([
        {
          name: "file",
          filename: "sample.docx",
          content: bytes,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.conversionId).toBe(sha);
      expect(body.data.format).toBe("docx");
      expect(body.data.markdown).toBe("# Hello\n\n본문");
      expect(body.data.cached).toBe(false);
      expect(body.data.originalName).toBe("sample.docx");
      expect(body.data.size).toBe(4);
      expect(body.data.images).toEqual([]);
      expect(convertImpl).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("같은 파일을 두 번 업로드하면 두 번째 응답의 cached=true", async () => {
    const app = await buildTestApp();
    try {
      const bytes = Buffer.from([7, 7, 7]);
      const { payload, contentType } = makeMultipart([
        { name: "file", filename: "x.docx", content: bytes },
      ]);

      const first = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json().data.cached).toBe(false);
      expect(second.json().data.cached).toBe(true);
      expect(convertImpl).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("file 필드가 없으면 400을 반환한다", async () => {
    const app = await buildTestApp();
    try {
      const { payload, contentType } = makeMultipart([
        { name: "notfile", content: Buffer.from("hi") },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe("string");
      expect(convertImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("지원하지 않는 확장자는 400을 반환한다", async () => {
    const app = await buildTestApp();
    try {
      const { payload, contentType } = makeMultipart([
        {
          name: "file",
          filename: "virus.exe",
          content: Buffer.from([0x4d, 0x5a]),
        },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
      expect(convertImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("파서 실패 시 500을 반환하고 에러 메시지가 envelope에 담긴다", async () => {
    convertImpl.mockRejectedValueOnce(new Error("parser boom"));
    const app = await buildTestApp();
    try {
      const { payload, contentType } = makeMultipart([
        { name: "file", filename: "broken.docx", content: Buffer.from([9]) },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/parser boom|변환/);
    } finally {
      await app.close();
    }
  });

  describe("JSON URL 입력", () => {
    async function buildAppWithFetch(
      safeFetchImpl: typeof import("../src/fetch/index.js").safeFetch,
    ) {
      const cache = new ConvertCache({
        storage,
        tmpDir: tmpRoot,
        convertImpl,
      });
      return buildServer({
        config: makeTestConfig(),
        convertCache: cache,
        safeFetchImpl,
      });
    }

    it("JSON { url } 바디로 원격 문서를 변환한다", async () => {
      const bytes = new Uint8Array([5, 5, 5, 5]);
      const safeFetchImpl = vi.fn(async () => ({
        ok: true as const,
        bytes,
        contentType: "application/pdf",
        contentDisposition: null,
        finalUrl: "https://example.com/report.pdf",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: { url: "https://example.com/report.pdf" },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.data.originalName).toBe("report.pdf");
        expect(body.data.size).toBe(4);
        expect(body.data.markdown).toBe("# Hello\n\n본문");
        expect(safeFetchImpl).toHaveBeenCalledWith(
          "https://example.com/report.pdf",
          expect.objectContaining({ maxBytes: expect.any(Number) }),
        );
        expect(convertImpl).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    });

    it("filename 힌트로 확장자를 보강할 수 있다", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: true as const,
        bytes: new Uint8Array([1]),
        contentType: null,
        contentDisposition: null,
        finalUrl: "https://example.com/download?id=42",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: {
            url: "https://example.com/download?id=42",
            filename: "report.hwpx",
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.originalName).toBe("report.hwpx");
      } finally {
        await app.close();
      }
    });

    it("Content-Disposition 헤더로 실제 파일명을 인식한다 (data.go.kr 같은 다운로드 URL)", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: true as const,
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "application/octet-stream",
        contentDisposition:
          'attachment; filename="한국장학재단_복권기금 꿈사다리 장학사업 발전방향 연구.hwpx"',
        finalUrl:
          "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: {
            url: "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE",
          },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.data.originalName).toMatch(/\.hwpx$/);
        expect(body.data.originalName).toContain("한국장학재단");
      } finally {
        await app.close();
      }
    });

    it("hint > Content-Disposition > URL basename 순으로 우선한다", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: true as const,
        bytes: new Uint8Array([1]),
        contentType: null,
        contentDisposition: 'attachment; filename="cd-name.docx"',
        finalUrl: "https://example.com/path/url-name.pdf",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        // hint 가 있으면 hint 우선
        const withHint = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: {
            url: "https://example.com/path/url-name.pdf",
            filename: "hint-name.hwpx",
          },
        });
        expect(withHint.json().data.originalName).toBe("hint-name.hwpx");
      } finally {
        await app.close();
      }
    });

    it("확장자를 어떤 후보에서도 찾을 수 없으면 400", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: true as const,
        bytes: new Uint8Array([1]),
        contentType: null,
        contentDisposition: null,
        finalUrl: "https://example.com/download",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: { url: "https://example.com/download" },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().success).toBe(false);
        expect(res.json().error).toMatch(/지원하지 않는|filename/);
        expect(safeFetchImpl).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    });

    it("사설 IP 등 차단된 호스트는 400을 반환한다", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: false as const,
        reason: "host-blocked" as const,
        message:
          "호스트 evil.example.com 가 차단된 IP (10.0.0.1) 로 해석됩니다.",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: { url: "http://evil.example.com/report.pdf" },
        });
        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.success).toBe(false);
        expect(body.error).toMatch(/차단된|10\.0\.0\.1/);
        expect(convertImpl).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it("오버사이즈 응답은 413을 반환한다", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: false as const,
        reason: "too-large" as const,
        message: "Content-Length(9999999) 가 허용 크기를 초과합니다.",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: { url: "https://example.com/huge.pdf" },
        });
        expect(res.statusCode).toBe(413);
      } finally {
        await app.close();
      }
    });

    it("타임아웃/네트워크 오류는 502를 반환한다", async () => {
      const safeFetchImpl = vi.fn(async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "요청이 시간 제한을 초과했습니다.",
      }));
      const app = await buildAppWithFetch(safeFetchImpl);
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: { url: "https://slow.example.com/file.pdf" },
        });
        expect(res.statusCode).toBe(502);
      } finally {
        await app.close();
      }
    });

    it("Content-Type 이 multipart/json 둘 다 아니면 400", async () => {
      const app = await buildTestApp();
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "text/plain" },
          payload: "hello",
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("JSON 바디 스키마 검증 실패 시 400", async () => {
      const app = await buildTestApp();
      try {
        const res = await app.inject({
          method: "POST",
          url: "/v1/convert",
          headers: { "content-type": "application/json" },
          payload: { wrong: "field" },
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });
});
