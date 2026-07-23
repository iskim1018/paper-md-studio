import type { lookup } from "node:dns/promises";
import {
  createImageAsset,
  extFromMime,
  makeImageName,
  mimeFromExt,
} from "../image-utils.js";
import { safeFetch } from "../net/safe-fetch.js";
import type { ImageAsset } from "../types.js";
import { bodyHtml, toDocument } from "./dom.js";

/** 문서당 다운로드할 최대 이미지 수 */
const DEFAULT_MAX_IMAGES = 50;
/** 이미지 1개당 최대 크기 (10MB) */
const DEFAULT_MAX_BYTES_PER_IMAGE = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface DownloadImagesOptions {
  readonly maxImages?: number;
  readonly maxBytesPerImage?: number;
  readonly timeoutMs?: number;
  /** 테스트 주입용 — 기본값은 global fetch */
  readonly fetchImpl?: typeof fetch;
  /** 테스트 주입용 — 기본값은 dns.lookup */
  readonly dnsLookup?: typeof lookup;
}

export interface DownloadImagesResult {
  readonly html: string;
  readonly images: Array<ImageAsset>;
}

/**
 * HTML 내 원격 이미지(http/https src)를 safeFetch로 다운로드하고
 * src를 `./{imagesDirName}/{파일명}` 상대 경로로 치환한다.
 * 다운로드 실패·비이미지 응답은 원본 URL을 그대로 유지한다 (부분 실패 허용).
 */
export async function downloadImages(
  html: string,
  imagesDirName: string,
  options: DownloadImagesOptions = {},
): Promise<DownloadImagesResult> {
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const document = toDocument(html);
  const targets = [...document.querySelectorAll("img[src]")].filter((img) => {
    const src = img.getAttribute("src");
    return src !== null && /^https?:\/\//i.test(src);
  });

  if (targets.length === 0) {
    return { html, images: [] };
  }

  const images: Array<ImageAsset> = [];
  const localNameByUrl = new Map<string, string>();

  for (const img of targets) {
    const src = img.getAttribute("src");
    if (!src) continue;

    const cached = localNameByUrl.get(src);
    if (cached) {
      img.setAttribute("src", `./${imagesDirName}/${cached}`);
      continue;
    }
    if (images.length >= maxImages) {
      continue;
    }

    const asset = await fetchImageAsset(src, images.length + 1, options);
    if (!asset) {
      continue;
    }

    images.push(asset);
    localNameByUrl.set(src, asset.name);
    img.setAttribute("src", `./${imagesDirName}/${asset.name}`);
  }

  return { html: bodyHtml(document), images };
}

async function fetchImageAsset(
  url: string,
  index: number,
  options: DownloadImagesOptions,
): Promise<ImageAsset | null> {
  const result = await safeFetch(url, {
    maxBytes: options.maxBytesPerImage ?? DEFAULT_MAX_BYTES_PER_IMAGE,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.dnsLookup ? { dnsLookup: options.dnsLookup } : {}),
  });
  if (!result.ok) {
    return null;
  }

  const type = resolveImageType(result.contentType, url);
  if (!type) {
    return null;
  }

  return createImageAsset(
    makeImageName(index, type.ext),
    result.bytes,
    type.mime,
  );
}

/** content-type 우선, 없으면 URL 확장자로 이미지 타입 판별. 둘 다 실패하면 null */
function resolveImageType(
  contentType: string | null,
  url: string,
): { ext: string; mime: string } | null {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = extFromMime(mime);
  if (ext !== ".bin") {
    return { ext, mime };
  }

  try {
    const pathExt = new URL(url).pathname
      .toLowerCase()
      .match(/\.[a-z0-9]+$/)?.[0];
    if (pathExt) {
      const inferred = mimeFromExt(pathExt);
      if (inferred !== "application/octet-stream") {
        return { ext: pathExt, mime: inferred };
      }
    }
  } catch {
    // URL 파싱 실패 시 타입 미상으로 처리
  }
  return null;
}
