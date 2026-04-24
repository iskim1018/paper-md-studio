import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
  storageRoot: z.string().default("./.paper-md-storage"),
  apiKeys: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  signingSecret: z.string().min(16).default("dev-secret-change-me-0123456789"),
  signedUrlTtlSeconds: z.coerce.number().int().min(60).default(900),
  maxUploadMb: z.coerce.number().int().min(1).default(50),
  publicBaseUrl: z
    .string()
    .default("")
    .transform((raw) =>
      raw.trim().length > 0 ? raw.replace(/\/$/, "") : null,
    ),
  publicMaxInlineKb: z.coerce.number().int().min(1).default(512),
  rateLimitPerMinute: z.coerce.number().int().min(1).default(60),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return ConfigSchema.parse({
    port: env.PORT,
    host: env.HOST,
    storageRoot: env.STORAGE_ROOT,
    apiKeys: env.API_KEYS,
    signingSecret: env.SIGNING_SECRET,
    signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
    maxUploadMb: env.MAX_UPLOAD_MB,
    publicBaseUrl: env.PAPER_MD_PUBLIC_BASE_URL,
    publicMaxInlineKb: env.PAPER_MD_PUBLIC_MAX_INLINE_KB,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    logLevel: env.LOG_LEVEL,
  });
}
