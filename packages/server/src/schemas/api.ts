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

export const ConvertDataSchema = z.object({
  conversionId: z.string(),
  format: z.enum(["hwp", "hwpx", "doc", "docx", "pdf"]),
  markdown: z.string(),
  images: z.array(ImageMetaSchema),
  cached: z.boolean(),
  elapsedMs: z.number(),
  createdAt: z.string(),
  originalName: z.string().nullable(),
  size: z.number().int().nonnegative(),
});

export type ConvertData = z.infer<typeof ConvertDataSchema>;

export const ConvertSuccessSchema = z.object({
  success: z.literal(true),
  data: ConvertDataSchema,
});

export function apiError(message: string): ApiError {
  return { success: false, error: message };
}
