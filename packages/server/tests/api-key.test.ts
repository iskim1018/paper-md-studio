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

function makeConfig(overrides: { apiKeys?: string } = {}): ServerConfig {
  return loadConfig({
    SIGNING_SECRET: "test-secret-abcdefghijklmnop",
    LOG_LEVEL: "silent",
    API_KEYS: overrides.apiKeys ?? "",
  });
}

describe("API Key 인증 미들웨어", () => {
  let storageRoot: string;
  let tmpRoot: string;
  let storage: LocalFsStorage;
  let convertImpl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-auth-storage-"));
    tmpRoot = await mkdtemp(join(tmpdir(), "paper-md-auth-tmp-"));
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

  function makeConvertRequest() {
    return makeMultipart([
      { name: "file", filename: "s.docx", content: Buffer.from([1, 2, 3]) },
    ]);
  }

  it("API_KEYS가 비어있으면 인증 비활성 — 헤더 없이도 200", async () => {
    const app = await buildTestApp(makeConfig({ apiKeys: "" }));
    try {
      const { payload, contentType } = makeConvertRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("API_KEYS 설정 + 헤더 없음 → 401 envelope", async () => {
    const app = await buildTestApp(makeConfig({ apiKeys: "k1,k2" }));
    try {
      const { payload, contentType } = makeConvertRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/API Key/);
      expect(convertImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("API_KEYS 설정 + 잘못된 키 → 401", async () => {
    const app = await buildTestApp(makeConfig({ apiKeys: "k1" }));
    try {
      const { payload, contentType } = makeConvertRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: {
          "content-type": contentType,
          "x-api-key": "wrong-key",
        },
        payload,
      });
      expect(res.statusCode).toBe(401);
      expect(convertImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("API_KEYS 설정 + 올바른 키 → 200", async () => {
    const app = await buildTestApp(makeConfig({ apiKeys: "k1,k2" }));
    try {
      const { payload, contentType } = makeConvertRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: {
          "content-type": contentType,
          "x-api-key": "k2",
        },
        payload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("/v1/health는 API Key 없이도 allowlist로 통과한다", async () => {
    const app = await buildTestApp(makeConfig({ apiKeys: "k1" }));
    try {
      const res = await app.inject({ method: "GET", url: "/v1/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ok");
    } finally {
      await app.close();
    }
  });
});
