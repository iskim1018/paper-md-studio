import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context.js";
import { registerConvertDocumentTool } from "./tools/convert-document.js";
import { registerGetDocumentChunkTool } from "./tools/get-document-chunk.js";
import { registerGetDocumentOutlineTool } from "./tools/get-document-outline.js";

export interface CreateMcpServerOptions {
  readonly context: McpContext;
  readonly name?: string;
  readonly version?: string;
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? "paper-md-studio",
      version: options.version ?? "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "paper-md-studio MCP 서버: HWP/HWPX/DOCX/DOC/PDF 문서를 Markdown 으로 변환하고, 목차·섹션 조회를 제공합니다. 큰 문서는 convert_document 로 먼저 변환한 뒤 conversionId 를 저장해 get_document_outline / get_document_chunk 로 부분 조회하면 토큰을 절감할 수 있습니다.",
    },
  );

  registerConvertDocumentTool(server, options.context);
  registerGetDocumentOutlineTool(server, options.context);
  registerGetDocumentChunkTool(server, options.context);

  return server;
}
