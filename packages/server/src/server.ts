import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { MemoryApiKeyStore, registerApiKeyAuth } from "./auth/index.js";
import { ConvertCache } from "./cache/index.js";
import type { ServerConfig } from "./config.js";
import { registerConvertRoute } from "./routes/convert.js";
import { LocalFsStorage } from "./storage/index.js";

export interface BuildServerOptions {
  readonly config: ServerConfig;
  /** 주입 시 내부에서 LocalFsStorage + ConvertCache 를 새로 만들지 않는다. */
  readonly convertCache?: ConvertCache;
}

const AUTH_ALLOWLIST = ["/v1/health"];

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

  const apiKeyStore = new MemoryApiKeyStore({
    keys: config.apiKeys,
    signingSecret: config.signingSecret,
  });
  await registerApiKeyAuth(app, {
    store: apiKeyStore,
    allowlist: AUTH_ALLOWLIST,
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024,
      files: 1,
    },
  });

  const convertCache =
    options.convertCache ??
    new ConvertCache({
      storage: new LocalFsStorage({ root: config.storageRoot }),
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

  await registerConvertRoute(app, { convertCache });

  return app;
}
