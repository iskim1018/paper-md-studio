import { extname } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConvertCache } from "../cache/index.js";
import {
  ApiErrorSchema,
  apiError,
  ConvertSuccessSchema,
} from "../schemas/api.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".hwp",
  ".hwpx",
  ".doc",
  ".docx",
  ".pdf",
]);

export interface RegisterConvertRouteOptions {
  readonly convertCache: ConvertCache;
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
  const { convertCache } = options;

  app.route({
    method: "POST",
    url: "/v1/convert",
    schema: {
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

      try {
        const result = await convertCache.convert({
          bytes: parsed.bytes,
          originalName: parsed.originalName,
        });
        return reply.code(200).send({
          success: true as const,
          data: {
            conversionId: result.meta.conversionId,
            format: result.meta.format,
            markdown: result.markdown,
            images: result.meta.images.map((img) => ({
              name: img.name,
              mimeType: img.mimeType,
              size: img.size,
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
