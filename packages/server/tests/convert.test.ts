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
});
