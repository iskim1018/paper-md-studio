import type { SignedUrlSigner } from "../auth/index.js";
import type { StorageAdapter, StoredImageInfo } from "../storage/index.js";
import type {
  ImageMode,
  InlineTooLargeInfo,
  ResponseImage,
  RewriteResult,
} from "./types.js";

// core 는 이미지 저장 시 `./images/<name>` 경로로 markdown 에 링크를 남긴다.
// 이 패턴만 인식하여 mode 별로 치환한다.
const IMAGE_REF_FULL = /!\[([^\]]*)\]\(\.\/images\/([^)\s]+)\)/g;
const IMAGE_REF_URL_ONLY = /(!\[[^\]]*\]\()\.\/images\/([^)\s]+)(\))/g;

export interface RewriteOptions {
  readonly markdown: string;
  readonly images: ReadonlyArray<StoredImageInfo>;
  readonly conversionId: string;
  readonly mode: ImageMode;
  readonly storage: StorageAdapter;
  readonly signer: SignedUrlSigner;
  readonly baseUrl: string | null;
  readonly maxInlineKb: number;
}

export async function rewriteMarkdown(
  options: RewriteOptions,
): Promise<RewriteResult> {
  switch (options.mode) {
    case "urls":
      return rewriteUrls(options);
    case "inline":
      return rewriteInline(options);
    case "refs":
      return rewriteRefs(options);
    case "omit":
      return rewriteOmit(options);
  }
}

function rewriteUrls(options: RewriteOptions): RewriteResult {
  const { markdown, images, conversionId, signer, baseUrl } = options;
  const responseImages: Array<ResponseImage> = [];
  const signed = new Map<string, string>();

  for (const img of images) {
    const { exp, sig } = signer.sign({ conversionId, name: img.name });
    const path = `/v1/conversions/${conversionId}/images/${encodeURIComponent(img.name)}?exp=${exp}&sig=${sig}`;
    const url = baseUrl ? `${baseUrl}${path}` : path;
    signed.set(img.name, url);
    responseImages.push({
      name: img.name,
      mimeType: img.mimeType,
      size: img.size,
      url,
    });
  }

  const nextMd = markdown.replace(
    IMAGE_REF_URL_ONLY,
    (match, prefix: string, name: string, suffix: string) => {
      const url = signed.get(decodeURIComponent(name));
      return url ? `${prefix}${url}${suffix}` : match;
    },
  );
  return { ok: true, markdown: nextMd, responseImages };
}

async function rewriteInline(options: RewriteOptions): Promise<RewriteResult> {
  const { markdown, images, conversionId, storage, maxInlineKb } = options;
  const limitBytes = maxInlineKb * 1024;
  const offenders: Array<InlineTooLargeInfo> = [];
  for (const img of images) {
    if (img.size > limitBytes) {
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
  const responseImages: Array<ResponseImage> = [];
  for (const img of images) {
    const stored = await storage.getImage(conversionId, img.name);
    if (!stored) {
      continue;
    }
    const base64 = Buffer.from(stored.data).toString("base64");
    dataUris.set(img.name, `data:${img.mimeType};base64,${base64}`);
    responseImages.push({
      name: img.name,
      mimeType: img.mimeType,
      size: img.size,
    });
  }

  const nextMd = markdown.replace(
    IMAGE_REF_URL_ONLY,
    (match, prefix: string, name: string, suffix: string) => {
      const uri = dataUris.get(decodeURIComponent(name));
      return uri ? `${prefix}${uri}${suffix}` : match;
    },
  );
  return { ok: true, markdown: nextMd, responseImages };
}

function rewriteRefs(options: RewriteOptions): RewriteResult {
  const { markdown, images, conversionId } = options;
  const refs = new Map<string, string>();
  const responseImages: Array<ResponseImage> = [];

  for (const img of images) {
    const uri = `conv://${conversionId}/images/${img.name}`;
    refs.set(img.name, uri);
    responseImages.push({
      name: img.name,
      mimeType: img.mimeType,
      size: img.size,
      uri,
    });
  }

  const nextMd = markdown.replace(
    IMAGE_REF_URL_ONLY,
    (match, prefix: string, name: string, suffix: string) => {
      const uri = refs.get(decodeURIComponent(name));
      return uri ? `${prefix}${uri}${suffix}` : match;
    },
  );
  return { ok: true, markdown: nextMd, responseImages };
}

function rewriteOmit(options: RewriteOptions): RewriteResult {
  const { markdown, images } = options;
  const responseImages: Array<ResponseImage> = images.map((img) => ({
    name: img.name,
    mimeType: img.mimeType,
    size: img.size,
  }));
  const nextMd = markdown.replace(IMAGE_REF_FULL, (_match, alt: string) => {
    const trimmed = alt.trim();
    return trimmed.length > 0 ? `_[이미지: ${trimmed}]_` : "_[이미지]_";
  });
  return { ok: true, markdown: nextMd, responseImages };
}
