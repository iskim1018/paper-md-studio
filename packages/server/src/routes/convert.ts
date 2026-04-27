import { basename, extname } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ConvertCache } from "../cache/index.js";
import {
  parseContentDispositionFilename,
  type SafeFetchResult,
  safeFetch,
} from "../fetch/index.js";
import type { ImageMode, SignedUrlSigner } from "../images/index.js";
import { IMAGE_MODES, rewriteMarkdown } from "../images/index.js";
import {
  ApiErrorSchema,
  apiError,
  ConvertSuccessSchema,
  ConvertUrlBodySchema,
} from "../schemas/api.js";
import type { StorageAdapter } from "../storage/index.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".hwp",
  ".hwpx",
  ".doc",
  ".docx",
  ".pdf",
]);

const QuerySchema = z.object({
  images: z
    .enum(IMAGE_MODES as unknown as [ImageMode, ...Array<ImageMode>])
    .optional(),
});

export interface RegisterConvertRouteOptions {
  readonly convertCache: ConvertCache;
  readonly storage: StorageAdapter;
  readonly signer: SignedUrlSigner;
  readonly baseUrl: string | null;
  readonly maxInlineKb: number;
  readonly maxUploadMb: number;
  readonly fetchTimeoutMs: number;
  /** 테스트 주입용 — 기본값은 globalThis.fetch 기반 safeFetch */
  readonly safeFetchImpl?: typeof safeFetch;
}

type ParsedInput =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly originalName: string;
    }
  | {
      readonly ok: false;
      readonly status: 400 | 413 | 502;
      readonly error: string;
    };

async function parseUpload(
  req: FastifyRequest,
  maxUploadMb: number,
): Promise<ParsedInput> {
  let file: Awaited<ReturnType<typeof req.file>>;
  try {
    file = await req.file();
  } catch (err: unknown) {
    req.log.warn({ err }, "멀티파트 파싱 실패");
    return {
      ok: false,
      status: 400,
      error: "멀티파트 요청을 해석할 수 없습니다.",
    };
  }

  if (!file) {
    return {
      ok: false,
      status: 400,
      error: "업로드된 파일이 없습니다. file 필드로 전송하세요.",
    };
  }

  const originalName = file.filename;
  if (!originalName) {
    return {
      ok: false,
      status: 400,
      error:
        "파일명이 없어 포맷을 판별할 수 없습니다. multipart filename을 포함하세요.",
    };
  }

  const ext = extname(originalName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      status: 400,
      error: `지원하지 않는 파일 형식입니다: ${ext} (지원: .hwp, .hwpx, .doc, .docx, .pdf)`,
    };
  }

  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (err: unknown) {
    if (isFileTooLargeError(err)) {
      return {
        ok: false,
        status: 413,
        error: `업로드 파일이 허용 크기(${maxUploadMb}MB)를 초과했습니다.`,
      };
    }
    req.log.error({ err }, "업로드 본문 읽기 실패");
    return {
      ok: false,
      status: 400,
      error: "업로드 본문을 읽을 수 없습니다.",
    };
  }

  if (buffer.byteLength === 0) {
    return {
      ok: false,
      status: 400,
      error: "업로드 파일이 비어 있습니다.",
    };
  }

  return { ok: true, bytes: new Uint8Array(buffer), originalName };
}

async function parseUrlBody(
  req: FastifyRequest,
  options: RegisterConvertRouteOptions,
): Promise<ParsedInput> {
  const parsed = ConvertUrlBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error:
        "요청 본문이 올바르지 않습니다. { url: string, filename?: string } 형식이어야 합니다.",
    };
  }

  const { url, filename } = parsed.data;

  const schemeCheck = checkScheme(url);
  if (!schemeCheck.ok) {
    return { ok: false, status: 400, error: schemeCheck.error };
  }

  const hint = filename?.trim() || null;
  const urlPathName = deriveFromUrlPath(url);

  // 파일명을 확정하기 전에 fetch — Content-Disposition 헤더로 실제 파일명을 얻기 위함.
  // (data.go.kr 같은 다운로드 엔드포인트는 URL path 에 확장자가 없음)
  const maxBytes = options.maxUploadMb * 1024 * 1024;
  const fetchImpl = options.safeFetchImpl ?? safeFetch;
  let fetched: SafeFetchResult;
  try {
    fetched = await fetchImpl(url, {
      maxBytes,
      timeoutMs: options.fetchTimeoutMs,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "원격 URL fetch 실패");
    return {
      ok: false,
      status: 502,
      error: "원격 URL 을 가져오는 중 오류가 발생했습니다.",
    };
  }

  if (!fetched.ok) {
    const status = mapFetchStatus(fetched.reason);
    return {
      ok: false,
      status,
      error: fetched.message,
    };
  }

  if (fetched.bytes.byteLength === 0) {
    return {
      ok: false,
      status: 400,
      error: "원격 URL 의 본문이 비어 있습니다.",
    };
  }

  // 우선순위: 사용자 힌트 > Content-Disposition > URL path basename.
  // 유효한 확장자를 가진 후보를 우선 선택, 없으면 첫 후보로 에러 메시지 생성.
  const cdName = parseContentDispositionFilename(fetched.contentDisposition);
  const candidates: Array<string> = [];
  if (hint) candidates.push(hint);
  if (cdName) candidates.push(cdName);
  if (urlPathName) candidates.push(urlPathName);

  const chosen = pickBestCandidate(candidates);
  if (!chosen) {
    return {
      ok: false,
      status: 400,
      error:
        "파일명을 추정할 수 없습니다. URL 경로에 확장자가 없고 Content-Disposition 헤더도 없습니다. filename 필드로 힌트를 제공하세요.",
    };
  }

  const ext = extname(chosen).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    const extLabel = ext.length > 0 ? ext : "(확장자 없음)";
    return {
      ok: false,
      status: 400,
      error: `지원하지 않는 파일 형식입니다: ${extLabel} (지원: .hwp, .hwpx, .doc, .docx, .pdf). 후보 파일명: "${chosen}". 필요 시 filename 필드로 다른 확장자를 명시하세요.`,
    };
  }

  return {
    ok: true,
    bytes: fetched.bytes,
    originalName: chosen,
  };
}

function pickBestCandidate(candidates: ReadonlyArray<string>): string | null {
  for (const c of candidates) {
    const ext = extname(c).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      return c;
    }
  }
  return candidates[0] ?? null;
}

function checkScheme(url: string): { ok: true } | { ok: false; error: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        error: `허용되지 않은 URL 스킴입니다: ${parsed.protocol}. http:// 또는 https:// 만 사용 가능합니다.`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: `URL 을 파싱할 수 없습니다: ${url}` };
  }
}

function deriveFromUrlPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname);
    if (name.length === 0) {
      return null;
    }
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  } catch {
    return null;
  }
}

function mapFetchStatus(
  reason: import("../fetch/index.js").SafeFetchReason,
): 400 | 413 | 502 {
  switch (reason) {
    case "scheme-blocked":
    case "host-blocked":
      return 400;
    case "too-large":
      return 413;
    case "timeout":
    case "redirect-loop":
    case "http-error":
    case "network-error":
      return 502;
  }
}

function isJsonContent(req: FastifyRequest): boolean {
  const ct = req.headers["content-type"];
  if (!ct) {
    return false;
  }
  return ct.toLowerCase().startsWith("application/json");
}

function isMultipartContent(req: FastifyRequest): boolean {
  const ct = req.headers["content-type"];
  if (!ct) {
    return false;
  }
  return ct.toLowerCase().startsWith("multipart/form-data");
}

export async function registerConvertRoute(
  app: FastifyInstance,
  options: RegisterConvertRouteOptions,
): Promise<void> {
  const { convertCache, storage, signer, baseUrl, maxInlineKb } = options;

  app.route({
    method: "POST",
    url: "/v1/convert",
    schema: {
      tags: ["convert"],
      summary: "문서 업로드 및 Markdown 변환",
      description:
        '두 가지 입력 방식: (1) `multipart/form-data` 의 `file` 필드로 파일 업로드. (2) `application/json` 바디에 `{ "url": "https://..." }` 전달 — 서버가 URL 을 fetch 해서 변환 (SSRF 방어 포함). 동일 파일(SHA-256 일치) 재요청 시 캐시 히트 응답. `?images=urls|inline|refs|omit` 로 이미지 전달 방식을 선택합니다.',
      querystring: QuerySchema,
      response: {
        200: ConvertSuccessSchema,
        400: ApiErrorSchema,
        413: ApiErrorSchema,
        500: ApiErrorSchema,
        502: ApiErrorSchema,
      },
    },
    handler: async (req, reply) => {
      let parsed: ParsedInput;
      if (isMultipartContent(req)) {
        parsed = await parseUpload(req, options.maxUploadMb);
      } else if (isJsonContent(req)) {
        parsed = await parseUrlBody(req, options);
      } else {
        return reply
          .code(400)
          .send(
            apiError(
              "Content-Type 은 multipart/form-data 또는 application/json 이어야 합니다.",
            ),
          );
      }

      if (!parsed.ok) {
        return reply.code(parsed.status).send(apiError(parsed.error));
      }
      const { images: mode = "urls" } = req.query as z.infer<
        typeof QuerySchema
      >;

      try {
        const result = await convertCache.convert({
          bytes: parsed.bytes,
          originalName: parsed.originalName,
        });

        const rewritten = await rewriteMarkdown({
          markdown: result.markdown,
          images: result.meta.images,
          conversionId: result.meta.conversionId,
          mode,
          storage,
          signer,
          baseUrl,
          maxInlineKb,
        });

        if (!rewritten.ok) {
          const names = rewritten.offenders.map((o) => o.name).join(", ");
          return reply
            .code(413)
            .send(
              apiError(
                `이미지가 인라인 크기 상한(${rewritten.limitKb}KB)을 초과했습니다: ${names}. ?images=urls 또는 ?images=refs 를 사용하세요.`,
              ),
            );
        }

        return reply.code(200).send({
          success: true as const,
          data: {
            conversionId: result.meta.conversionId,
            format: result.meta.format,
            markdown: rewritten.markdown,
            images: rewritten.responseImages.map((img) => ({
              name: img.name,
              mimeType: img.mimeType,
              size: img.size,
              ...(img.url === undefined ? {} : { url: img.url }),
              ...(img.uri === undefined ? {} : { uri: img.uri }),
            })),
            cached: result.cached,
            elapsedMs: result.elapsedMs,
            createdAt: result.meta.createdAt,
            originalName: result.meta.originalName,
            size: result.meta.size,
          },
        });
      } catch (err: unknown) {
        req.log.error({ err }, "변환 실패");
        const message =
          err instanceof Error ? err.message : "변환 중 오류가 발생했습니다.";
        return reply.code(500).send(apiError(message));
      }
    },
  });
}

function isFileTooLargeError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "FST_REQ_FILE_TOO_LARGE"
  );
}
