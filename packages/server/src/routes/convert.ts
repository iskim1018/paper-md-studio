import { extname } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SignedUrlSigner } from "../auth/index.js";
import type { ConvertCache } from "../cache/index.js";
import type { ImageMode } from "../images/index.js";
import { IMAGE_MODES, rewriteMarkdown } from "../images/index.js";
import {
  ApiErrorSchema,
  apiError,
  ConvertSuccessSchema,
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
}

type ParsedUpload =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly originalName: string;
    }
  | { readonly ok: false; readonly status: 400 | 413; readonly error: string };

async function parseUpload(req: FastifyRequest): Promise<ParsedUpload> {
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
        error: "업로드 파일이 허용 크기를 초과했습니다.",
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
        "multipart/form-data 의 `file` 필드로 문서를 업로드합니다. 동일 파일(SHA-256 일치) 재업로드 시 캐시 히트 응답. `?images=urls|inline|refs|omit` 로 이미지 전달 방식을 선택합니다.",
      querystring: QuerySchema,
      response: {
        200: ConvertSuccessSchema,
        400: ApiErrorSchema,
        413: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const parsed = await parseUpload(req);
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
