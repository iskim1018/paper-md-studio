import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { LocalFsStorage } from "../src/storage/index.js";

function makeTestConfig() {
  return loadConfig({
    SIGNING_SECRET: "test-secret-abcdefghijklmnop",
    LOG_LEVEL: "silent",
  });
}

describe("GET /v1/conversions/:id", () => {
  let storageRoot: string;
  let storage: LocalFsStorage;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-conv-get-"));
    storage = new LocalFsStorage({ root: storageRoot });
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("저장된 변환 결과의 meta + markdown 을 반환한다", async () => {
    const sha = "a".repeat(64);
    const meta = await storage.put({
      sha256: sha,
      format: "docx",
      markdown: "# Title\n\nbody",
      images: [],
      elapsed: 123,
      originalName: "sample.docx",
      size: 999,
    });

    const app = await buildServer({
      config: makeTestConfig(),
      storage,
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${meta.conversionId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.conversionId).toBe(sha);
      expect(body.data.markdown).toBe("# Title\n\nbody");
      expect(body.data.format).toBe("docx");
      expect(body.data.originalName).toBe("sample.docx");
      expect(body.data.size).toBe(999);
      expect(body.data.cached).toBe(true);
      expect(body.data.images).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("없는 id 는 404", async () => {
    const app = await buildServer({
      config: makeTestConfig(),
      storage,
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/v1/conversions/${"b".repeat(64)}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().success).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("잘못된 형식의 id 는 400", async () => {
    const app = await buildServer({
      config: makeTestConfig(),
      storage,
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/conversions/not-hex",
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
