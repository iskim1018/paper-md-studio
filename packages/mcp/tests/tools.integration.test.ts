import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import { LocalFsStorage } from "@paper-md-studio/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { EmbeddedConverter } from "../src/converters/index.js";
import { createMcpServer } from "../src/server.js";

interface ToolJsonPayload {
  conversionId: string;
  format: string;
  cached: boolean;
  elapsedMs: number;
  originalName: string | null;
  size: number;
  markdown: string;
  images: ReadonlyArray<{ name: string; uri?: string }>;
  outline: ReadonlyArray<{ level: number; text: string; anchor: string }>;
}

function parseToolText<T>(result: {
  content: ReadonlyArray<{ type: string; text?: string }>;
}): T {
  const first = result.content[0];
  if (!first || first.type !== "text" || !first.text) {
    throw new Error("툴 응답에 text content 가 없습니다.");
  }
  return JSON.parse(first.text) as T;
}

describe("MCP tools integration (in-memory transport)", () => {
  let storageRoot: string;
  let client: Client;
  let convertImpl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-mcp-test-"));

    const config: McpConfig = {
      mode: "embedded",
      storageRoot,
      restUrl: null,
      maxUploadMb: 10,
      maxInlineKb: 64,
      fetchTimeoutMs: 30000,
      logLevel: "silent",
    };

    convertImpl = vi.fn(
      async (_options: ConvertOptions): Promise<ConvertResult> => ({
        markdown:
          "# 문서 제목\n\n인트로 본문입니다.\n\n## 섹션 A\n\n섹션 A 본문.\n\n### 하위 항목 A1\n\n하위 본문.\n\n## 섹션 B\n\n섹션 B 본문.\n",
        images: [],
        format: "docx",
        elapsed: 10,
      }),
    );

    const storage = new LocalFsStorage({ root: storageRoot });
    const converter = new EmbeddedConverter({
      storage,
      convertImpl: convertImpl as unknown as (
        o: ConvertOptions,
      ) => Promise<ConvertResult>,
    });
    const context = createContext({ config, converter });
    const server = createMcpServer({ context });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client(
      { name: "test-client", version: "0.0.1" },
      { capabilities: {} },
    );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("lists the three MVP tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "convert_document",
      "get_document_chunk",
      "get_document_outline",
    ]);
  });

  it("converts a base64 docx and returns outline", async () => {
    const fakeDocx = Buffer.from("not-a-real-docx-but-bytes").toString(
      "base64",
    );
    const result = await client.callTool({
      name: "convert_document",
      arguments: {
        input: { base64: fakeDocx, filename: "sample.docx" },
        images: "refs",
      },
    });
    const payload = parseToolText<ToolJsonPayload>(
      result as { content: ReadonlyArray<{ type: string; text?: string }> },
    );
    expect(payload.cached).toBe(false);
    expect(payload.format).toBe("docx");
    expect(payload.outline.map((n) => n.text)).toEqual([
      "문서 제목",
      "섹션 A",
      "하위 항목 A1",
      "섹션 B",
    ]);
    expect(convertImpl).toHaveBeenCalledTimes(1);
  });

  it("hits cache on second call with same bytes", async () => {
    const fakeDocx = Buffer.from("stable-content").toString("base64");
    const first = await client.callTool({
      name: "convert_document",
      arguments: {
        input: { base64: fakeDocx, filename: "sample.docx" },
      },
    });
    const firstPayload = parseToolText<ToolJsonPayload>(
      first as { content: ReadonlyArray<{ type: string; text?: string }> },
    );

    const second = await client.callTool({
      name: "convert_document",
      arguments: {
        input: { base64: fakeDocx, filename: "sample.docx" },
      },
    });
    const secondPayload = parseToolText<ToolJsonPayload>(
      second as { content: ReadonlyArray<{ type: string; text?: string }> },
    );

    expect(firstPayload.conversionId).toBe(secondPayload.conversionId);
    expect(firstPayload.cached).toBe(false);
    expect(secondPayload.cached).toBe(true);
    expect(secondPayload.elapsedMs).toBeLessThan(100);
    expect(convertImpl).toHaveBeenCalledTimes(1);
  });

  it("returns outline via get_document_outline", async () => {
    const convertResult = await client.callTool({
      name: "convert_document",
      arguments: {
        input: {
          base64: Buffer.from("doc-a").toString("base64"),
          filename: "a.docx",
        },
      },
    });
    const convertPayload = parseToolText<ToolJsonPayload>(
      convertResult as {
        content: ReadonlyArray<{ type: string; text?: string }>;
      },
    );

    const outlineResult = await client.callTool({
      name: "get_document_outline",
      arguments: { conversionId: convertPayload.conversionId },
    });
    const outlinePayload = parseToolText<{
      outline: ReadonlyArray<{ level: number; text: string; anchor: string }>;
    }>(
      outlineResult as {
        content: ReadonlyArray<{ type: string; text?: string }>;
      },
    );
    expect(outlinePayload.outline.map((n) => n.anchor)).toEqual([
      "문서-제목",
      "섹션-a",
      "하위-항목-a1",
      "섹션-b",
    ]);
  });

  it("returns a section via get_document_chunk by anchor", async () => {
    const convertResult = await client.callTool({
      name: "convert_document",
      arguments: {
        input: {
          base64: Buffer.from("doc-b").toString("base64"),
          filename: "b.docx",
        },
      },
    });
    const convertPayload = parseToolText<ToolJsonPayload>(
      convertResult as {
        content: ReadonlyArray<{ type: string; text?: string }>;
      },
    );

    const chunkResult = await client.callTool({
      name: "get_document_chunk",
      arguments: {
        conversionId: convertPayload.conversionId,
        anchor: "섹션-a",
      },
    });
    const chunkPayload = parseToolText<{
      markdown: string;
      anchor: string;
      neighbors: { prev: string | null; next: string | null };
    }>(
      chunkResult as {
        content: ReadonlyArray<{ type: string; text?: string }>;
      },
    );

    expect(chunkPayload.anchor).toBe("섹션-a");
    expect(chunkPayload.markdown).toContain("## 섹션 A");
    expect(chunkPayload.markdown).toContain("### 하위 항목 A1");
    expect(chunkPayload.markdown).not.toContain("## 섹션 B");
    expect(chunkPayload.neighbors.prev).toBe("문서-제목");
    expect(chunkPayload.neighbors.next).toBe("하위-항목-a1");
  });

  it("returns error when conversionId is unknown", async () => {
    const result = await client.callTool({
      name: "get_document_outline",
      arguments: { conversionId: "nonexistent" },
    });
    const typed = result as {
      isError?: boolean;
      content: ReadonlyArray<{ type: string; text?: string }>;
    };
    expect(typed.isError).toBe(true);
    expect(typed.content[0]?.text).toMatch(/찾을 수 없습니다/);
  });
});
