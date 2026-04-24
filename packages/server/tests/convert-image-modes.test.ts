import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvertCache } from "../src/cache/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { LocalFsStorage } from "../src/storage/index.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIG_IMAGE = Buffer.alloc(600 * 1024, 0x61); // 600KB

interface Part {
  readonly name: string;
  readonly filename?: string;
  readonly content: Buffer;
}

function makeMultipart(parts: ReadonlyArray<Part>): {
  payload: Buffer;
  contentType: string;
} {
  const boundary = `----b${Math.random().toString(16).slice(2)}`;
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

function makeConfig(
  overrides: { publicBaseUrl?: string; maxInlineKb?: string } = {},
): ServerConfig {
  return loadConfig({
    SIGNING_SECRET: "test-secret-abcdefghijklmnop",
    LOG_LEVEL: "silent",
    PAPER_MD_PUBLIC_BASE_URL: overrides.publicBaseUrl ?? "",
    PAPER_MD_PUBLIC_MAX_INLINE_KB: overrides.maxInlineKb ?? "512",
  });
}

describe("POST /v1/convert?images= 모드", () => {
  let storageRoot: string;
  let tmpRoot: string;
  let storage: LocalFsStorage;
  let convertImpl: ReturnType<typeof vi.fn>;

  function mockConvertReturns(imageBytes: Buffer = PNG): void {
    convertImpl = vi.fn(
      async (_options: ConvertOptions): Promise<ConvertResult> => ({
        markdown:
          "# 제목\n\n![로고](./images/img_001.png)\n\n본문\n\n![](./images/img_002.png)",
        images: [
          { name: "img_001.png", data: imageBytes, mimeType: "image/png" },
          { name: "img_002.png", data: imageBytes, mimeType: "image/png" },
        ],
        format: "hwpx",
        elapsed: 5,
      }),
    );
  }

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-modes-storage-"));
    tmpRoot = await mkdtemp(join(tmpdir(), "paper-md-modes-tmp-"));
    storage = new LocalFsStorage({ root: storageRoot });
    mockConvertReturns();
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(tmpRoot, { recursive: true, force: true });
  });

  async function buildTestApp(config: ServerConfig) {
    const cache = new ConvertCache({ storage, tmpDir: tmpRoot, convertImpl });
    return buildServer({ config, storage, convertCache: cache });
  }

  function makeRequest() {
    return makeMultipart([
      { name: "file", filename: "a.hwpx", content: Buffer.from([1, 2, 3]) },
    ]);
  }

  it("기본값(?images 미지정) 은 urls 모드로 동작", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.markdown).toMatch(
        /\/v1\/conversions\/[a-f0-9]{64}\/images\/img_001\.png\?exp=/,
      );
      expect(body.data.images[0].url).toMatch(/exp=/);
    } finally {
      await app.close();
    }
  });

  it("?images=urls + PAPER_MD_PUBLIC_BASE_URL → 절대 URL", async () => {
    const app = await buildTestApp(
      makeConfig({ publicBaseUrl: "https://docs.example.com" }),
    );
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert?images=urls",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.markdown).toContain(
        "https://docs.example.com/v1/conversions/",
      );
      expect(body.data.images[0].url).toMatch(
        /^https:\/\/docs\.example\.com\//,
      );
    } finally {
      await app.close();
    }
  });

  it("?images=inline → data URI 삽입, 응답 url 없음", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert?images=inline",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.markdown).toContain("data:image/png;base64,");
      expect(body.data.images[0].url).toBeUndefined();
      expect(body.data.images[0].uri).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("?images=inline + 이미지 한계 초과 → 413", async () => {
    mockConvertReturns(BIG_IMAGE);
    const app = await buildTestApp(makeConfig({ maxInlineKb: "128" }));
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert?images=inline",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/인라인 크기 상한/);
      expect(body.error).toMatch(/\?images=urls|\?images=refs/);
    } finally {
      await app.close();
    }
  });

  it("?images=refs → conv:// URI 사용, 응답 uri 필드", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert?images=refs",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.markdown).toMatch(
        /conv:\/\/[a-f0-9]{64}\/images\/img_001\.png/,
      );
      expect(body.data.images[0].uri).toMatch(/^conv:\/\//);
      expect(body.data.images[0].url).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("?images=omit → placeholder 삽입", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert?images=omit",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.markdown).toContain("_[이미지: 로고]_");
      expect(body.data.markdown).toContain("_[이미지]_");
      expect(body.data.markdown).not.toContain("![");
      expect(body.data.images).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("?images=unknown-value → 400", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const { payload, contentType } = makeRequest();
      const res = await app.inject({
        method: "POST",
        url: "/v1/convert?images=xxx",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
