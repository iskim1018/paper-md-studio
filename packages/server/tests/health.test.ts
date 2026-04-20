import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

describe("GET /v1/health", () => {
  it("returns ok status", async () => {
    const app = await buildServer({
      config: loadConfig({
        SIGNING_SECRET: "test-secret-abcdefghijklmnop",
        LOG_LEVEL: "silent",
      }),
    });

    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/health",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        status: "ok",
        version: "0.1.0",
      });
    } finally {
      await app.close();
    }
  });
});
