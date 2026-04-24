import type { StoredImageInfo } from "@paper-md-studio/server";

/** inline 모드에서 이미지 바이트를 공급하는 최소 인터페이스 (Converter.getImage 와 호환). */
export interface ImageSource {
  getImage(
    conversionId: string,
    name: string,
  ): Promise<{ data: Uint8Array; mimeType: string; size: number } | null>;
}

export type McpImageMode = "refs" | "inline" | "omit";

export interface McpImageResult {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly uri?: string;
}

export interface RewriteOkResult {
  readonly ok: true;
  readonly markdown: string;
  readonly images: ReadonlyArray<McpImageResult>;
}

export interface InlineTooLarge {
  readonly name: string;
  readonly size: number;
}

export interface RewriteFailResult {
  readonly ok: false;
  readonly reason: "inline-image-too-large";
  readonly offenders: ReadonlyArray<InlineTooLarge>;
  readonly limitKb: number;
}

export type McpRewriteResult = RewriteOkResult | RewriteFailResult;

export interface McpRewriteOptions {
  readonly markdown: string;
  readonly images: ReadonlyArray<StoredImageInfo>;
  readonly conversionId: string;
  readonly mode: McpImageMode;
  readonly imageSource: ImageSource;
  readonly maxInlineKb: number;
}

const IMAGE_REF_FULL = /!\[([^\]]*)\]\(\.\/images\/([^)\s]+)\)/g;
const IMAGE_REF_URL_ONLY = /(!\[[^\]]*\]\()\.\/images\/([^)\s]+)(\))/g;

export async function rewriteForMcp(
  options: McpRewriteOptions,
): Promise<McpRewriteResult> {
  switch (options.mode) {
    case "refs":
      return rewriteRefs(options);
    case "inline":
      return rewriteInline(options);
    case "omit":
      return rewriteOmit(options);
  }
}

function rewriteRefs(options: McpRewriteOptions): RewriteOkResult {
  const { markdown, images, conversionId } = options;
  const lookup = new Map<string, string>();
  const result: Array<McpImageResult> = [];
  for (const img of images) {
    const uri = `conv://${conversionId}/images/${img.name}`;
    lookup.set(img.name, uri);
    result.push({
      name: img.name,
      mimeType: img.mimeType,
      size: img.size,
      uri,
    });
  }
  const next = markdown.replace(
    IMAGE_REF_URL_ONLY,
    (match, prefix: string, name: string, suffix: string) => {
      const uri = lookup.get(decodeURIComponent(name));
      return uri ? `${prefix}${uri}${suffix}` : match;
    },
  );
  return { ok: true, markdown: next, images: result };
}

async function rewriteInline(
  options: McpRewriteOptions,
): Promise<McpRewriteResult> {
  const { markdown, images, conversionId, imageSource, maxInlineKb } = options;
  const limit = maxInlineKb * 1024;
  const offenders: Array<InlineTooLarge> = [];
  for (const img of images) {
    if (img.size > limit) {
      offenders.push({ name: img.name, size: img.size });
    }
  }
  if (offenders.length > 0) {
    return {
      ok: false,
      reason: "inline-image-too-large",
      offenders,
      limitKb: maxInlineKb,
    };
  }

  const dataUris = new Map<string, string>();
  const result: Array<McpImageResult> = [];
  for (const img of images) {
    const stored = await imageSource.getImage(conversionId, img.name);
    if (!stored) {
      continue;
    }
    const base64 = Buffer.from(stored.data).toString("base64");
    dataUris.set(img.name, `data:${img.mimeType};base64,${base64}`);
    result.push({ name: img.name, mimeType: img.mimeType, size: img.size });
  }

  const next = markdown.replace(
    IMAGE_REF_URL_ONLY,
    (match, prefix: string, name: string, suffix: string) => {
      const uri = dataUris.get(decodeURIComponent(name));
      return uri ? `${prefix}${uri}${suffix}` : match;
    },
  );
  return { ok: true, markdown: next, images: result };
}

function rewriteOmit(options: McpRewriteOptions): RewriteOkResult {
  const { markdown, images } = options;
  const next = markdown.replace(IMAGE_REF_FULL, (_match, alt: string) => {
    const trimmed = alt.trim();
    return trimmed.length > 0 ? `_[이미지: ${trimmed}]_` : "_[이미지]_";
  });
  const result: Array<McpImageResult> = images.map((img) => ({
    name: img.name,
    mimeType: img.mimeType,
    size: img.size,
  }));
  return { ok: true, markdown: next, images: result };
}
