import type { DocumentFormat, ImageAsset } from "@paper-md-studio/core";

export interface StoredImageInfo {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface StoredMeta {
  readonly conversionId: string;
  readonly format: DocumentFormat;
  readonly sha256: string;
  readonly createdAt: string;
  readonly elapsed: number;
  readonly originalName: string | null;
  readonly size: number;
  readonly images: ReadonlyArray<StoredImageInfo>;
}

export interface StoredImage {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly size: number;
}

export interface PutConversionInput {
  readonly sha256: string;
  readonly format: DocumentFormat;
  readonly markdown: string;
  readonly images: ReadonlyArray<ImageAsset>;
  readonly elapsed: number;
  readonly originalName: string | null;
  readonly size: number;
}

export interface StorageAdapter {
  has(conversionId: string): Promise<boolean>;
  put(input: PutConversionInput): Promise<StoredMeta>;
  getMeta(conversionId: string): Promise<StoredMeta | null>;
  getMarkdown(conversionId: string): Promise<string | null>;
  getImage(conversionId: string, name: string): Promise<StoredImage | null>;
  delete(conversionId: string): Promise<void>;
  list(): Promise<ReadonlyArray<StoredMeta>>;
}
