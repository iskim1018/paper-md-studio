import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpContext } from "../context.js";
import { type ChunkSelector, extractChunk } from "../outline/chunk.js";

const inputShape = {
  conversionId: z.string().min(1),
  anchor: z.string().min(1).optional(),
  headingPath: z.array(z.string().min(1)).min(1).optional(),
  range: z
    .object({
      start: z.number().int().min(0),
      end: z.number().int().min(1),
    })
    .optional(),
} as const;

interface ChunkArgs {
  readonly anchor?: string;
  readonly headingPath?: ReadonlyArray<string>;
  readonly range?: { readonly start: number; readonly end: number };
}

function buildSelector(args: ChunkArgs): ChunkSelector | null {
  if (args.anchor !== undefined) {
    return { anchor: args.anchor };
  }
  if (args.headingPath !== undefined) {
    return { headingPath: args.headingPath };
  }
  if (args.range !== undefined) {
    return { range: args.range };
  }
  return null;
}

export function registerGetDocumentChunkTool(
  server: McpServer,
  context: McpContext,
): void {
  server.registerTool(
    "get_document_chunk",
    {
      title: "문서 섹션 조회",
      description:
        "변환된 문서에서 anchor/headingPath/range 로 특정 섹션만 잘라 반환합니다. 이웃 섹션의 anchor 도 함께 제공합니다.",
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      const provided = [
        args.anchor !== undefined,
        args.headingPath !== undefined,
        args.range !== undefined,
      ].filter(Boolean).length;
      if (provided !== 1) {
        return {
          content: [
            {
              type: "text",
              text: "anchor / headingPath / range 중 정확히 하나만 지정해야 합니다.",
            },
          ],
          isError: true,
        };
      }

      const markdown = await context.converter.getMarkdown(args.conversionId);
      if (markdown === null) {
        return {
          content: [
            {
              type: "text",
              text: `conversionId 를 찾을 수 없습니다: ${args.conversionId}.`,
            },
          ],
          isError: true,
        };
      }

      const selector = buildSelector(args);
      if (!selector) {
        return {
          content: [{ type: "text", text: "selector 가 누락되었습니다." }],
          isError: true,
        };
      }

      const chunk = extractChunk(markdown, selector);
      if (chunk === null) {
        return {
          content: [
            { type: "text", text: "해당하는 섹션을 찾을 수 없습니다." },
          ],
          isError: true,
        };
      }

      const payload = {
        markdown: chunk.markdown,
        anchor: chunk.anchor,
        headingPath: chunk.headingPath,
        range: chunk.range,
        neighbors: chunk.neighbors,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );
}
