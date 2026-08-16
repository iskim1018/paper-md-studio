import type {
  DocumentFormat,
  HiddenExclusion,
  ImageAsset,
} from "@paper-md-studio/core";

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
  /**
   * 변환 경고 (한국어 메시지). 캐시 히트에서도 같은 경고가 나가야 하므로
   * meta 에 함께 저장한다 — 첫 요청만 경고를 받고 이후 요청은 못 받으면
   * 소비자마다 다른 그림을 보게 된다.
   */
  readonly warnings?: ReadonlyArray<string>;
  /** 숨김 처리로 제외된 항목 수 (엑셀 전용, 제외된 게 있을 때만) */
  readonly hiddenExcluded?: HiddenExclusion;
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
  readonly warnings?: ReadonlyArray<string>;
  readonly hiddenExcluded?: HiddenExclusion;
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
