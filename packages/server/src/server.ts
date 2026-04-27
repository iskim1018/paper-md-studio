import fastifyMultipart from "@fastify/multipart";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError, z } from "zod";
import { ConvertCache } from "./cache/index.js";
import type { ServerConfig } from "./config.js";
import type { safeFetch } from "./fetch/index.js";
import { createSignedUrlSigner } from "./images/index.js";
import { registerConversionsRoute } from "./routes/conversions.js";
import { registerConvertRoute } from "./routes/convert.js";
import { registerImageRoute } from "./routes/images.js";
import { apiError } from "./schemas/api.js";
import { LocalFsStorage, type StorageAdapter } from "./storage/index.js";

export interface BuildServerOptions {
  readonly config: ServerConfig;
  /** 주입 시 내부에서 LocalFsStorage 를 새로 만들지 않는다. */
  readonly storage?: StorageAdapter;
  /** 주입 시 내부에서 ConvertCache 를 새로 만들지 않는다. */
  readonly convertCache?: ConvertCache;
  /** 테스트 주입용 — 기본값은 fetch.ts 의 safeFetch (외부 URL 을 가져올 때 사용) */
  readonly safeFetchImpl?: typeof safeFetch;
}

export async function buildServer(
  options: BuildServerOptions,
): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err, req, reply) => {
    if (
      hasZodFastifySchemaValidationErrors(err) ||
      err instanceof ZodError ||
      (err as { code?: string }).code === "FST_ERR_VALIDATION"
    ) {
      return reply.code(400).send(apiError("요청 검증에 실패했습니다."));
    }
    req.log.error({ err }, "처리되지 않은 예외");
    return reply
      .code(500)
      .send(apiError(err instanceof Error ? err.message : "알 수 없는 오류"));
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "paper-md-studio REST API",
        description:
          "HWP/HWPX/DOCX/DOC/PDF 문서를 Markdown 으로 변환하는 서버 API. content-addressed 캐시로 동일 파일 재요청을 파싱 없이 응답합니다.",
        version: "0.1.0",
      },
      servers: config.publicBaseUrl ? [{ url: config.publicBaseUrl }] : [],
      tags: [
        { name: "health", description: "liveness 프로브" },
        { name: "convert", description: "문서 → Markdown 변환" },
        { name: "images", description: "변환된 이미지 조회 (signed URL)" },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024,
      files: 1,
    },
  });

  const storage =
    options.storage ?? new LocalFsStorage({ root: config.storageRoot });
  const signer = createSignedUrlSigner({
    secret: config.signingSecret,
    ttlSeconds: config.signedUrlTtlSeconds,
  });
  const convertCache =
    options.convertCache ??
    new ConvertCache({
      storage,
      logger: app.log,
    });

  app.route({
    method: "GET",
    url: "/v1/health",
    schema: {
      tags: ["health"],
      summary: "liveness 프로브",
      description: "서버가 응답 가능한 상태인지 확인합니다.",
      response: {
        200: z.object({
          status: z.literal("ok"),
          version: z.string(),
        }),
      },
    },
    handler: async () => ({
      status: "ok" as const,
      version: "0.1.0",
    }),
  });

  await registerConvertRoute(app, {
    convertCache,
    storage,
    signer,
    baseUrl: config.publicBaseUrl,
    maxInlineKb: config.publicMaxInlineKb,
    maxUploadMb: config.maxUploadMb,
    fetchTimeoutMs: config.fetchTimeoutMs,
    ...(options.safeFetchImpl ? { safeFetchImpl: options.safeFetchImpl } : {}),
  });
  await registerImageRoute(app, { storage, signer });
  await registerConversionsRoute(app, { storage });

  return app;
}
