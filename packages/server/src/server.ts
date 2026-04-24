import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError, z } from "zod";
import {
  createSignedUrlSigner,
  MemoryApiKeyStore,
  registerApiKeyAuth,
} from "./auth/index.js";
import { ConvertCache } from "./cache/index.js";
import type { ServerConfig } from "./config.js";
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
}

const AUTH_ALLOWLIST = ["/v1/health"];
const SIGNED_IMAGE_PATTERN = /^\/v1\/conversions\/[a-f0-9]{64}\/images\//;

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

  const apiKeyStore = new MemoryApiKeyStore({
    keys: config.apiKeys,
    signingSecret: config.signingSecret,
  });
  await registerApiKeyAuth(app, {
    store: apiKeyStore,
    allowlist: AUTH_ALLOWLIST,
    bypassPatterns: [SIGNED_IMAGE_PATTERN],
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
  });
  await registerImageRoute(app, { storage, signer });

  return app;
}
