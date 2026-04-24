import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ApiErrorSchema,
  apiError,
  ConvertSuccessSchema,
} from "../schemas/api.js";
import type { StorageAdapter } from "../storage/index.js";

const CONVERSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const NOT_FOUND_ERROR = "해당 conversionId 를 찾을 수 없습니다.";

const ParamsSchema = z.object({
  id: z.string(),
});

export interface RegisterConversionsRouteOptions {
  readonly storage: StorageAdapter;
}

export async function registerConversionsRoute(
  app: FastifyInstance,
  options: RegisterConversionsRouteOptions,
): Promise<void> {
  const { storage } = options;

  app.route({
    method: "GET",
    url: "/v1/conversions/:id",
    schema: {
      tags: ["convert"],
      summary: "변환 결과 조회",
      description:
        "이미 변환된 문서의 metadata 와 markdown 을 반환합니다. `POST /v1/convert` 로 얻은 conversionId 로 이후 후속 호출 (outline/chunk 계산 등) 을 할 때 사용합니다. 이미지 바이너리는 포함되지 않으며, `images[].url` (signed) 로 별도 다운로드합니다.",
      params: ParamsSchema,
      response: {
        200: ConvertSuccessSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const { id } = req.params as z.infer<typeof ParamsSchema>;

      if (!CONVERSION_ID_PATTERN.test(id)) {
        return reply
          .code(400)
          .send(apiError("conversionId 형식이 올바르지 않습니다."));
      }

      const meta = await storage.getMeta(id);
      if (!meta) {
        return reply.code(404).send(apiError(NOT_FOUND_ERROR));
      }
      const markdown = await storage.getMarkdown(id);
      if (markdown === null) {
        return reply.code(404).send(apiError(NOT_FOUND_ERROR));
      }

      return reply.code(200).send({
        success: true as const,
        data: {
          conversionId: meta.conversionId,
          format: meta.format,
          markdown,
          images: meta.images.map((img) => ({
            name: img.name,
            mimeType: img.mimeType,
            size: img.size,
          })),
          cached: true,
          elapsedMs: 0,
          createdAt: meta.createdAt,
          originalName: meta.originalName,
          size: meta.size,
        },
      });
    },
  });
}
