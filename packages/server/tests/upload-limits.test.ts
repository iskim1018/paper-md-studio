import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvertCache } from "../src/cache/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { LocalFsStorage } from "../src/storage/index.js";

interface Part {
  readonly name: string;
  readonly filename?: string;
  readonly content: Buffer;
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
    header += "\r\n\r\n";
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

function makeConfig(overrides: { maxUploadMb?: string } = {}): ServerConfig {
  return loadConfig({
    SIGNING_SECRET: "test-secret-abcdefghijklmnop",
    LOG_LEVEL: "silent",
    MAX_UPLOAD_MB: overrides.maxUploadMb ?? "50",
  });
}

describe("업로드 한계 가드", () => {
  let storageRoot: string;
  let tmpRoot: string;
  let storage: LocalFsStorage;
  let convertImpl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-limits-storage-"));
    tmpRoot = await mkdtemp(join(tmpdir(), "paper-md-limits-tmp-"));
    storage = new LocalFsStorage({ root: storageRoot });
    convertImpl = vi.fn(
      async (_options: ConvertOptions): Promise<ConvertResult> => ({
        markdown: "# ok",
        images: [],
        format: "docx",
        elapsed: 1,
      }),
    );
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(tmpRoot, { recursive: true, force: true });
  });

  async function buildTestApp(config: ServerConfig) {
    const cache = new ConvertCache({ storage, tmpDir: tmpRoot, convertImpl });
    return buildServer({ config, convertCache: cache });
  }

  it("MAX_UPLOAD_MB 초과 파일은 413을 반환한다", async () => {
    const app = await buildTestApp(makeConfig({ maxUploadMb: "1" }));
    try {
      // 1MB 한계 초과 — 2MB 더미 페이로드
      const oversized = Buffer.alloc(2 * 1024 * 1024, 0x61);
      const { payload, contentType } = makeMultipart([
        { name: "file", filename: "big.docx", content: oversized },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/크기/);
      expect(convertImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("빈 파일 업로드는 400을 반환한다", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const { payload, contentType } = makeMultipart([
        { name: "file", filename: "empty.docx", content: Buffer.alloc(0) },
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
      expect(body.error).toMatch(/비어|empty|빈/i);
      expect(convertImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("허용 크기 이내 + 정상 확장자는 통과한다", async () => {
    const app = await buildTestApp(makeConfig({ maxUploadMb: "1" }));
    try {
      // 한계 안쪽 — 500KB
      const payload500k = Buffer.alloc(500 * 1024, 0x61);
      const { payload, contentType } = makeMultipart([
        { name: "file", filename: "ok.docx", content: payload500k },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(convertImpl).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
