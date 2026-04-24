#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const context = createContext({ config });
  const server = createMcpServer({ context });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  context.logger.info(
    {
      event: "server.started",
      mode: config.mode,
      storageRoot: config.mode === "embedded" ? config.storageRoot : null,
      restUrl: config.mode === "remote" ? config.restUrl : null,
    },
    `MCP 서버가 stdio 로 시작되었습니다 (mode=${config.mode}).`,
  );
}

main().catch((error: unknown) => {
  const msg =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[paper-md-mcp] 기동 실패: ${msg}\n`);
  process.exit(1);
});
