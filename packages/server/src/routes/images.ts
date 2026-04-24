import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SignedUrlSigner } from "../auth/index.js";
import { apiError } from "../schemas/api.js";
import type { StorageAdapter } from "../storage/index.js";

const CONVERSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const SIGNED_URL_ERROR = "이미지 URL 이 유효하지 않습니다.";
const SIGNATURE_REQUIRED_ERROR = "이미지 URL 서명이 필요합니다.";
const NOT_FOUND_ERROR = "이미지를 찾을 수 없습니다.";

const ParamsSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const QuerySchema = z.object({
  exp: z.coerce.number().int(),
  sig: z.string(),
});

export interface RegisterImageRouteOptions {
  readonly storage: StorageAdapter;
  readonly signer: SignedUrlSigner;
}

export async function registerImageRoute(
  app: FastifyInstance,
  options: RegisterImageRouteOptions,
): Promise<void> {
  const { storage, signer } = options;

  app.route({
    method: "GET",
    url: "/v1/conversions/:id/images/:name",
    schema: {
      params: ParamsSchema,
    },
    handler: async (req, reply) => {
      const { id, name } = req.params as z.infer<typeof ParamsSchema>;

      // 64-hex 검증 실패 → 404 (정보 노출 방지)
      if (!CONVERSION_ID_PATTERN.test(id)) {
        return reply.code(404).send(apiError(NOT_FOUND_ERROR));
      }

      // 서명 쿼리 파싱 (Zod 로 느슨하게 검증 — 누락/타입 에러는 401 로 변환)
      const queryParsed = QuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        return reply.code(401).send(apiError(SIGNATURE_REQUIRED_ERROR));
      }
      const { exp, sig } = queryParsed.data;

      // 서명 검증 — 만료/위조 모두 동일 메시지
      const verified = signer.verify({ conversionId: id, name, exp, sig });
      if (!verified.ok) {
        return reply.code(401).send(apiError(SIGNED_URL_ERROR));
      }

      // 스토리지 조회
      const image = await storage.getImage(id, name);
      if (!image) {
        return reply.code(404).send(apiError(NOT_FOUND_ERROR));
      }

      reply
        .code(200)
        .header("content-type", image.mimeType)
        .header("content-length", image.size)
        .header("cache-control", "private, max-age=60");
      return reply.send(Buffer.from(image.data));
    },
  });
}
