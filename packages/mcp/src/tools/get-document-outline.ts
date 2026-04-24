import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpContext } from "../context.js";
import { extractOutline } from "../outline/extract.js";

const inputShape = {
  conversionId: z.string().min(1),
} as const;

export function registerGetDocumentOutlineTool(
  server: McpServer,
  context: McpContext,
): void {
  server.registerTool(
    "get_document_outline",
    {
      title: "문서 목차 조회",
      description:
        "이미 변환된 문서의 헤딩 트리(outline)를 반환합니다. conversionId 는 convert_document 결과에서 얻을 수 있습니다.",
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      const markdown = await context.converter.getMarkdown(args.conversionId);
      if (markdown === null) {
        return {
          content: [
            {
              type: "text",
              text: `conversionId 를 찾을 수 없습니다: ${args.conversionId}. 먼저 convert_document 로 변환하세요.`,
            },
          ],
          isError: true,
        };
      }
      const outline = extractOutline(markdown).map((node) => ({
        level: node.level,
        text: node.text,
        anchor: node.anchor,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ outline }, null, 2) }],
        structuredContent: { outline },
      };
    },
  );
}
