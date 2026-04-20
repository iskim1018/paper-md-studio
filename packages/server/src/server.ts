import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { ServerConfig } from "./config.js";

export interface BuildServerOptions {
  readonly config: ServerConfig;
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

  return app;
}
