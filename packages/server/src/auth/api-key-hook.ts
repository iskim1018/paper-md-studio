import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";
import { apiError } from "../schemas/api.js";
import type { ApiKeyStore } from "./api-key-store.js";

const API_KEY_HEADER = "x-api-key";
const AUTH_ERROR_MESSAGE = "API Key 인증에 실패했습니다.";

export interface RegisterApiKeyAuthOptions {
  readonly store: ApiKeyStore;
  /** 인증을 요구하지 않는 경로 (정확 매치, 쿼리스트링은 무시) */
  readonly allowlist?: ReadonlyArray<string>;
  /**
   * 자체 인증 수단(signed URL 등)을 가진 라우트의 경로 패턴.
   * 매치되면 API Key 검증을 스킵하고 라우트 핸들러가 직접 인증.
   */
  readonly bypassPatterns?: ReadonlyArray<RegExp>;
}

export async function registerApiKeyAuth(
  app: FastifyInstance,
  options: RegisterApiKeyAuthOptions,
): Promise<void> {
  const { store } = options;
  if (!store.enabled) {
    return;
  }
  const allowlist = new Set(options.allowlist ?? []);
  const bypassPatterns = options.bypassPatterns ?? [];
  app.addHook("onRequest", createAuthHook(store, allowlist, bypassPatterns));
}

function createAuthHook(
  store: ApiKeyStore,
  allowlist: ReadonlySet<string>,
  bypassPatterns: ReadonlyArray<RegExp>,
): onRequestHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(req.url);
    if (allowlist.has(path)) {
      return;
    }
    if (bypassPatterns.some((pat) => pat.test(path))) {
      return;
    }
    const candidate = extractHeader(req.headers[API_KEY_HEADER]);
    const valid = candidate ? await store.isValid(candidate) : false;
    if (valid) {
      return;
    }
    req.log.warn(
      {
        event: "auth.failed",
        keyPrefix: candidate ? candidate.slice(0, 8) : null,
      },
      "API Key 인증 실패",
    );
    return reply.code(401).send(apiError(AUTH_ERROR_MESSAGE));
  };
}

function pathOf(url: string): string {
  return url.split("?", 1)[0] ?? url;
}

function extractHeader(
  value: string | ReadonlyArray<string> | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }
  return null;
}
