import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PAPER_MD_MCP_MODE: z.enum(["embedded", "remote"]).optional(),
  PAPER_MD_MCP_REST_URL: z.string().url().optional(),
  PAPER_MD_MCP_API_KEY: z.string().min(1).optional(),
  PAPER_MD_MCP_STORAGE: z.string().min(1).optional(),
  PAPER_MD_MCP_MAX_UPLOAD_MB: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  PAPER_MD_MCP_MAX_INLINE_KB: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  PAPER_MD_MCP_FETCH_TIMEOUT_MS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number.parseInt(v, 10))
    .optional(),
  PAPER_MD_MCP_LOG: z
    .enum(["silent", "error", "warn", "info", "debug"])
    .optional(),
});

export type McpMode = "embedded" | "remote";

export interface McpConfig {
  readonly mode: McpMode;
  readonly storageRoot: string;
  readonly restUrl: string | null;
  readonly apiKey: string | null;
  readonly maxUploadMb: number;
  readonly maxInlineKb: number;
  readonly fetchTimeoutMs: number;
  readonly logLevel: "silent" | "error" | "warn" | "info" | "debug";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = envSchema.parse(env);
  const defaultRoot = join(homedir(), ".paper-md-studio", "mcp-storage");
  const mode: McpMode = parsed.PAPER_MD_MCP_MODE ?? "embedded";

  if (mode === "remote" && !parsed.PAPER_MD_MCP_REST_URL) {
    throw new Error(
      "PAPER_MD_MCP_MODE=remote 이지만 PAPER_MD_MCP_REST_URL 이 지정되지 않았습니다.",
    );
  }

  return {
    mode,
    storageRoot: parsed.PAPER_MD_MCP_STORAGE ?? defaultRoot,
    restUrl: parsed.PAPER_MD_MCP_REST_URL ?? null,
    apiKey: parsed.PAPER_MD_MCP_API_KEY ?? null,
    maxUploadMb: parsed.PAPER_MD_MCP_MAX_UPLOAD_MB ?? 50,
    maxInlineKb: parsed.PAPER_MD_MCP_MAX_INLINE_KB ?? 512,
    fetchTimeoutMs: parsed.PAPER_MD_MCP_FETCH_TIMEOUT_MS ?? 120000,
    logLevel: parsed.PAPER_MD_MCP_LOG ?? "info",
  };
}
