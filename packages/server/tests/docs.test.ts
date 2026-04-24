import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

function makeConfig(overrides: { apiKeys?: string } = {}): ServerConfig {
  return loadConfig({
    SIGNING_SECRET: "test-secret-abcdefghijklmnop",
    LOG_LEVEL: "silent",
    API_KEYS: overrides.apiKeys ?? "",
  });
}

describe("OpenAPI 문서화", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    app = await buildServer({ config: makeConfig() });
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /docs 는 Swagger UI HTML 을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/docs",
    });
    expect([200, 302]).toContain(res.statusCode);
  });

  it("GET /docs/json 은 OpenAPI 3 스펙을 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/docs/json",
    });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(
      typeof spec.openapi === "string" || typeof spec.swagger === "string",
    ).toBe(true);
    expect(typeof spec.paths).toBe("object");
  });

  it("스펙에 /v1/convert POST, /v1/health GET 이 포함된다", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = res.json();
    expect(spec.paths["/v1/convert"]).toBeDefined();
    expect(spec.paths["/v1/convert"].post).toBeDefined();
    expect(spec.paths["/v1/health"]).toBeDefined();
    expect(spec.paths["/v1/health"].get).toBeDefined();
  });

  it("securitySchemes 에 apiKey(X-API-Key) 가 정의돼 있다", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = res.json();
    const schemes = spec.components?.securitySchemes;
    expect(schemes).toBeDefined();
    const apiKey = schemes.apiKey;
    expect(apiKey).toBeDefined();
    expect(apiKey.type).toBe("apiKey");
    expect(apiKey.name).toBe("X-API-Key");
    expect(apiKey.in).toBe("header");
  });
});

describe("OpenAPI allowlist", () => {
  it("API_KEYS 설정돼 있어도 /docs, /docs/json 은 인증 없이 통과", async () => {
    const app = await buildServer({
      config: makeConfig({ apiKeys: "prod-key-1" }),
    });
    try {
      const docs = await app.inject({ method: "GET", url: "/docs" });
      const json = await app.inject({ method: "GET", url: "/docs/json" });
      expect([200, 302]).toContain(docs.statusCode);
      expect(json.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
