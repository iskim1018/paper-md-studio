import type { ImageAsset } from "./types.js";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".emf": "image/emf",
  ".wmf": "image/wmf",
};

const EXT_FROM_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "image/emf": ".emf",
  "image/wmf": ".wmf",
};

/** 파일 확장자로 MIME 타입 추론 */
export function mimeFromExt(filename: string): string {
  const ext = filename.toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/** MIME 타입에서 확장자 추론 */
export function extFromMime(mimeType: string): string {
  return EXT_FROM_MIME[mimeType] ?? ".bin";
}

/** 순번 기반 이미지 파일명 생성 (img_001.png) */
export function makeImageName(index: number, ext: string): string {
  const num = String(index).padStart(3, "0");
  const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
  return `img_${num}${normalizedExt}`;
}

/** 이미지 디렉토리 기준 상대 경로로 img 태그 생성 */
export function imageToHtml(
  imagesDirName: string,
  imageName: string,
  alt: string,
): string {
  return `<img src="./${imagesDirName}/${imageName}" alt="${alt}">`;
}

/** ImageAsset 생성 헬퍼 */
export function createImageAsset(
  name: string,
  data: Uint8Array,
  mimeType: string,
): ImageAsset {
  return { name, data, mimeType };
}
