import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import {
  buildServer,
  ConvertCache,
  LocalFsStorage,
  loadConfig,
} from "@paper-md-studio/server";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { RemoteConverter } from "../src/converters/index.js";
import { createMcpServer } from "../src/server.js";

interface ToolJsonPayload {
  conversionId: string;
  format: string;
  cached: boolean;
  markdown: string;
  outline: ReadonlyArray<{ level: number; text: string; anchor: string }>;
}

function parseToolText<T>(result: {
  content: ReadonlyArray<{ type: string; text?: string }>;
}): T {
  const first = result.content[0];
  if (!first?.text) throw new Error("툴 응답 text 가 없습니다");
  return JSON.parse(first.text) as T;
}

describe("MCP remote mode (RemoteConverter ↔ REST server)", () => {
  let restApp: FastifyInstance;
  let restStorageRoot: string;
  let mcpStorageRoot: string;
  let client: Client;

  beforeEach(async () => {
    restStorageRoot = await mkdtemp(join(tmpdir(), "paper-md-rest-"));
    mcpStorageRoot = await mkdtemp(join(tmpdir(), "paper-md-mcp-remote-"));

    // REST 서버: 고정된 markdown 반환하도록 convertImpl 주입
    const convertImpl = vi.fn(
      async (_options: ConvertOptions): Promise<ConvertResult> => ({
        markdown: "# 원격 문서\n\n## 섹션 A\n\n본문\n\n## 섹션 B\n\n본문2\n",
        images: [],
        format: "pdf",
        elapsed: 15,
      }),
    );
    const restStorage = new LocalFsStorage({ root: restStorageRoot });
    const convertCache = new ConvertCache({
      storage: restStorage,
      convertImpl,
    });
    restApp = await buildServer({
      config: loadConfig({
        SIGNING_SECRET: "remote-test-secret-0123456789abcdef",
        LOG_LEVEL: "silent",
      }),
      storage: restStorage,
      convertCache,
    });
    await restApp.listen({ port: 0, host: "127.0.0.1" });
    const address = restApp.server.address();
    if (!address || typeof address === "string") {
      throw new Error("REST listen address 를 알 수 없음");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // MCP: remote 모드 + RemoteConverter 가 위 REST 를 호출
    const mcpConfig: McpConfig = {
      mode: "remote",
      storageRoot: mcpStorageRoot,
      restUrl: baseUrl,
      apiKey: null,
      maxUploadMb: 10,
      maxInlineKb: 64,
      fetchTimeoutMs: 30000,
      logLevel: "silent",
    };
    const converter = new RemoteConverter({ baseUrl });
    const context = createContext({ config: mcpConfig, converter });
    const mcpServer = createMcpServer({ context });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client(
      { name: "remote-test", version: "0.0.1" },
      { capabilities: {} },
    );
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await restApp.close();
    await rm(restStorageRoot, { recursive: true, force: true });
    await rm(mcpStorageRoot, { recursive: true, force: true });
  });

  it("convert_document (base64 입력) → REST 호출 → Markdown 반환", async () => {
    const bytes = Buffer.from("fake-pdf-bytes");
    const res = await client.callTool({
      name: "convert_document",
      arguments: {
        input: { base64: bytes.toString("base64"), filename: "sample.pdf" },
        images: "refs",
      },
    });
    const payload = parseToolText<ToolJsonPayload>(
      res as { content: ReadonlyArray<{ type: string; text?: string }> },
    );
    expect(payload.format).toBe("pdf");
    expect(payload.markdown).toContain("원격 문서");
    expect(payload.outline.map((n) => n.text)).toEqual([
      "원격 문서",
      "섹션 A",
      "섹션 B",
    ]);
  });

  it("path 입력 → 400 (remote 모드는 로컬 FS 접근 불가)", async () => {
    const res = await client.callTool({
      name: "convert_document",
      arguments: {
        input: { path: "/Users/me/foo.pdf" },
      },
    });
    const typed = res as {
      isError?: boolean;
      content: ReadonlyArray<{ type: string; text?: string }>;
    };
    expect(typed.isError).toBe(true);
    expect(typed.content[0]?.text).toMatch(/remote 모드에서는 로컬 path/);
  });

  it("images=inline → 400 (remote 미지원)", async () => {
    const res = await client.callTool({
      name: "convert_document",
      arguments: {
        input: {
          base64: Buffer.from("x").toString("base64"),
          filename: "a.pdf",
        },
        images: "inline",
      },
    });
    const typed = res as {
      isError?: boolean;
      content: ReadonlyArray<{ type: string; text?: string }>;
    };
    expect(typed.isError).toBe(true);
    expect(typed.content[0]?.text).toMatch(/inline 을 지원하지 않습니다/);
  });

  it("get_document_outline → REST GET /v1/conversions/:id 경유", async () => {
    const convertRes = await client.callTool({
      name: "convert_document",
      arguments: {
        input: {
          base64: Buffer.from("test-bytes").toString("base64"),
          filename: "a.pdf",
        },
      },
    });
    const payload = parseToolText<ToolJsonPayload>(
      convertRes as { content: ReadonlyArray<{ type: string; text?: string }> },
    );

    const outlineRes = await client.callTool({
      name: "get_document_outline",
      arguments: { conversionId: payload.conversionId },
    });
    const outlinePayload = parseToolText<{
      outline: ReadonlyArray<{ text: string; anchor: string }>;
    }>(
      outlineRes as {
        content: ReadonlyArray<{ type: string; text?: string }>;
      },
    );
    expect(outlinePayload.outline.map((n) => n.text)).toEqual([
      "원격 문서",
      "섹션 A",
      "섹션 B",
    ]);
  });

  it("get_document_chunk (anchor 기반) → REST 경유 markdown 로 섹션 추출", async () => {
    const convertRes = await client.callTool({
      name: "convert_document",
      arguments: {
        input: {
          base64: Buffer.from("test-bytes-2").toString("base64"),
          filename: "b.pdf",
        },
      },
    });
    const payload = parseToolText<ToolJsonPayload>(
      convertRes as { content: ReadonlyArray<{ type: string; text?: string }> },
    );

    const chunkRes = await client.callTool({
      name: "get_document_chunk",
      arguments: {
        conversionId: payload.conversionId,
        anchor: "섹션-a",
      },
    });
    const chunkPayload = parseToolText<{ markdown: string; anchor: string }>(
      chunkRes as { content: ReadonlyArray<{ type: string; text?: string }> },
    );
    expect(chunkPayload.anchor).toBe("섹션-a");
    expect(chunkPayload.markdown).toContain("## 섹션 A");
    expect(chunkPayload.markdown).not.toContain("## 섹션 B");
  });
});
