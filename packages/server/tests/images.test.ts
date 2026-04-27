import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignedUrlSigner } from "../src/auth/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { LocalFsStorage, sha256Hex } from "../src/storage/index.js";

const SIGNING_SECRET = "test-secret-abcdefghijklmnop";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeConfig(overrides: { apiKeys?: string } = {}): ServerConfig {
  return loadConfig({
    SIGNING_SECRET,
    LOG_LEVEL: "silent",
    API_KEYS: overrides.apiKeys ?? "",
    SIGNED_URL_TTL_SECONDS: "900",
  });
}

interface SeedResult {
  readonly conversionId: string;
  readonly imageName: string;
}

async function seedImage(storage: LocalFsStorage): Promise<SeedResult> {
  const bytes = new Uint8Array([9, 9, 9, 9]);
  const sha = sha256Hex(bytes);
  await storage.put({
    sha256: sha,
    format: "hwpx",
    markdown: "![](./images/img_001.png)",
    images: [{ name: "img_001.png", data: PNG_MAGIC, mimeType: "image/png" }],
    elapsed: 10,
    originalName: "seed.hwpx",
    size: bytes.byteLength,
  });
  return { conversionId: sha, imageName: "img_001.png" };
}

describe("GET /v1/conversions/:id/images/:name", () => {
  let storageRoot: string;
  let storage: LocalFsStorage;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-img-storage-"));
    storage = new LocalFsStorage({ root: storageRoot });
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function buildTestApp(config: ServerConfig) {
    return buildServer({ config, storage });
  }

  it("유효한 서명 URL 로 이미지 바이너리를 반환한다", async () => {
    const { conversionId, imageName } = await seedImage(storage);
    const app = await buildTestApp(makeConfig());
    try {
      const signer = createSignedUrlSigner({
        secret: SIGNING_SECRET,
        ttlSeconds: 900,
      });
      const { exp, sig } = signer.sign({ conversionId, name: imageName });

      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/${imageName}?exp=${exp}&sig=${sig}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
      expect(res.headers["cache-control"]).toMatch(/private/);
      // rawPayload 는 Buffer; 처음 8바이트 PNG 매직 비교
      expect(res.rawPayload.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("서명이 없으면 401", async () => {
    const { conversionId, imageName } = await seedImage(storage);
    const app = await buildTestApp(makeConfig());
    try {
      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/${imageName}`,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().success).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("위조된 서명은 401 (단일 에러 메시지)", async () => {
    const { conversionId, imageName } = await seedImage(storage);
    const app = await buildTestApp(makeConfig());
    try {
      const signer = createSignedUrlSigner({
        secret: SIGNING_SECRET,
        ttlSeconds: 900,
      });
      const { exp, sig } = signer.sign({ conversionId, name: imageName });
      const lastChar = sig.slice(-1);
      const replacement = lastChar === "0" ? "1" : "0";
      const tampered = `${sig.slice(0, -1)}${replacement}`;

      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/${imageName}?exp=${exp}&sig=${tampered}`,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("만료된 서명은 401 — 위조와 동일 메시지", async () => {
    const { conversionId, imageName } = await seedImage(storage);
    const app = await buildTestApp(makeConfig());
    try {
      const signer = createSignedUrlSigner({
        secret: SIGNING_SECRET,
        ttlSeconds: 900,
      });
      const past = Math.floor(Date.now() / 1000) - 3600;
      const { sig } = signer.sign({
        conversionId,
        name: imageName,
        nowSeconds: past - 900,
      });

      const expiredRes = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/${imageName}?exp=${past}&sig=${sig}`,
      });
      const invalidRes = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/${imageName}?exp=${Math.floor(Date.now() / 1000) + 900}&sig=0000`,
      });

      expect(expiredRes.statusCode).toBe(401);
      expect(invalidRes.statusCode).toBe(401);
      expect(expiredRes.json().error).toBe(invalidRes.json().error);
    } finally {
      await app.close();
    }
  });

  it("존재하지 않는 conversionId 는 404 (서명은 유효)", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const ghostId = "0".repeat(64);
      const signer = createSignedUrlSigner({
        secret: SIGNING_SECRET,
        ttlSeconds: 900,
      });
      const { exp, sig } = signer.sign({
        conversionId: ghostId,
        name: "img_001.png",
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${ghostId}/images/img_001.png?exp=${exp}&sig=${sig}`,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("없는 이미지 이름은 404", async () => {
    const { conversionId } = await seedImage(storage);
    const app = await buildTestApp(makeConfig());
    try {
      const signer = createSignedUrlSigner({
        secret: SIGNING_SECRET,
        ttlSeconds: 900,
      });
      const { exp, sig } = signer.sign({
        conversionId,
        name: "missing.png",
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/missing.png?exp=${exp}&sig=${sig}`,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("64-hex 가 아닌 id 는 404 (정보 노출 방지)", async () => {
    const app = await buildTestApp(makeConfig());
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/conversions/not-a-hash/images/x.png?exp=1&sig=abc",
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("API_KEYS 설정돼 있어도 유효한 서명 URL 은 API Key 없이 200", async () => {
    const { conversionId, imageName } = await seedImage(storage);
    const app = await buildTestApp(makeConfig({ apiKeys: "prod-key-1" }));
    try {
      const signer = createSignedUrlSigner({
        secret: SIGNING_SECRET,
        ttlSeconds: 900,
      });
      const { exp, sig } = signer.sign({ conversionId, name: imageName });

      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${conversionId}/images/${imageName}?exp=${exp}&sig=${sig}`,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
