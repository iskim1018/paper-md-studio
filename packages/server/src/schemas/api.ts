import { z } from "zod";

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

const ImageMetaSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string().optional(),
  uri: z.string().optional(),
});

/** 숨김 처리로 변환에서 제외된 항목 수 (엑셀 전용) */
export const HiddenExcludedSchema = z.object({
  sheets: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  cols: z.number().int().nonnegative(),
});

export const ConvertDataSchema = z.object({
  conversionId: z.string(),
  format: z.enum(["hwp", "hwpx", "doc", "docx", "pdf", "html", "xlsx", "xls"]),
  markdown: z.string(),
  images: z.array(ImageMetaSchema),
  cached: z.boolean(),
  elapsedMs: z.number(),
  createdAt: z.string(),
  originalName: z.string().nullable(),
  size: z.number().int().nonnegative(),
  /** 변환은 됐지만 소비자가 알아야 할 사항 (스캔 PDF, 숨김 제외 등) */
  warnings: z.array(z.string()).optional(),
  /** 숨김 제외 규모 — 경고 문구를 파싱하지 않고 판단할 수 있게 구조화 */
  hiddenExcluded: HiddenExcludedSchema.optional(),
});

export type ConvertData = z.infer<typeof ConvertDataSchema>;

export const ConvertSuccessSchema = z.object({
  success: z.literal(true),
  data: ConvertDataSchema,
});

export function apiError(message: string): ApiError {
  return { success: false, error: message };
}

export const ConvertUrlBodySchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).optional(),
});

export type ConvertUrlBody = z.infer<typeof ConvertUrlBodySchema>;
