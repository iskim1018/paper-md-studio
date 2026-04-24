import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpContext } from "../context.js";
import { type McpImageMode, rewriteForMcp } from "../image-rewrite.js";
import { resolveInput } from "../input-resolver.js";
import { extractOutline } from "../outline/extract.js";

const imageModeSchema = z.enum(["refs", "inline", "omit"]);

const inputShape = {
  input: z
    .object({
      path: z.string().optional(),
      url: z.string().url().optional(),
      base64: z.string().optional(),
      filename: z.string().optional(),
      mime: z.string().optional(),
    })
    .refine((v) => Boolean(v.path) || Boolean(v.url) || Boolean(v.base64), {
      message: "path / url / base64 중 하나는 반드시 지정해야 합니다.",
    }),
  images: imageModeSchema.default("refs"),
} as const;

export function registerConvertDocumentTool(
  server: McpServer,
  context: McpContext,
): void {
  server.registerTool(
    "convert_document",
    {
      title: "문서 → Markdown 변환",
      description:
        "HWP/HWPX/DOCX/DOC/PDF 를 Markdown 으로 변환합니다. 동일 파일 재호출 시 SHA-256 캐시 히트로 즉시 반환됩니다.",
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        // Remote 모드 제약: path 입력 불가 (서버 측 FS 가 아님), inline 이미지 모드 불가
        if (context.converter.mode === "remote") {
          if (args.input.path) {
            return {
              content: [
                {
                  type: "text",
                  text: "remote 모드에서는 로컬 path 입력을 사용할 수 없습니다 (MCP 서버가 원격에 있어 로컬 파일시스템을 읽을 수 없음). url 또는 base64 를 사용하세요.",
                },
              ],
              isError: true,
            };
          }
          if (args.images === "inline") {
            return {
              content: [
                {
                  type: "text",
                  text: "remote 모드는 images=inline 을 지원하지 않습니다. images=refs (기본) 또는 images=omit 를 사용하세요.",
                },
              ],
              isError: true,
            };
          }
        }

        const resolved = await resolveInput(
          {
            ...(args.input.path ? { path: args.input.path } : {}),
            ...(args.input.url ? { url: args.input.url } : {}),
            ...(args.input.base64 ? { base64: args.input.base64 } : {}),
            ...(args.input.filename ? { filename: args.input.filename } : {}),
            ...(args.input.mime ? { mime: args.input.mime } : {}),
          },
          { maxUploadMb: context.config.maxUploadMb },
        );

        const convertResult = await context.converter.convert({
          bytes: resolved.bytes,
          originalName: resolved.originalName,
        });

        const rewriteMode: McpImageMode = args.images;
        const rewrite = await rewriteForMcp({
          markdown: convertResult.markdown,
          images: convertResult.images,
          conversionId: convertResult.conversionId,
          mode: rewriteMode,
          imageSource: context.converter,
          maxInlineKb: context.config.maxInlineKb,
        });

        if (!rewrite.ok) {
          return {
            content: [
              {
                type: "text",
                text: `인라인 이미지 중 한도(${rewrite.limitKb}KB)를 초과한 항목이 있습니다: ${rewrite.offenders.map((o) => `${o.name}(${(o.size / 1024).toFixed(1)}KB)`).join(", ")}. images="refs" 또는 "omit" 모드를 사용하세요.`,
              },
            ],
            isError: true,
          };
        }

        const outline = extractOutline(rewrite.markdown);

        const payload = {
          conversionId: convertResult.conversionId,
          format: convertResult.format,
          cached: convertResult.cached,
          elapsedMs: Math.round(convertResult.elapsedMs),
          originalName: convertResult.originalName,
          size: convertResult.size,
          markdown: rewrite.markdown,
          images: rewrite.images,
          outline: outline.map((node) => ({
            level: node.level,
            text: node.text,
            anchor: node.anchor,
          })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        context.logger.error({ event: "convert_document.error", error: msg });
        return {
          content: [{ type: "text", text: `변환 실패: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
