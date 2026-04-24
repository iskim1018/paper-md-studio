import type { DocumentFormat } from "@paper-md-studio/core";

export type McpMode = "embedded" | "remote";

export interface ConverterInput {
  readonly bytes: Uint8Array;
  readonly originalName: string | null;
}

export interface ConvertedImage {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface ConverterOutput {
  readonly conversionId: string;
  readonly format: DocumentFormat;
  readonly markdown: string;
  readonly images: ReadonlyArray<ConvertedImage>;
  readonly cached: boolean;
  readonly elapsedMs: number;
  readonly originalName: string | null;
  readonly size: number;
}

export interface Converter {
  readonly mode: McpMode;
  convert(input: ConverterInput): Promise<ConverterOutput>;
  /** conversionId 로 저장된 markdown 을 가져온다. 없으면 null. */
  getMarkdown(conversionId: string): Promise<string | null>;
  /** 이미지 바이트 조회 (inline 모드 전용). remote 에서는 지원 안 할 수 있음. */
  getImage(
    conversionId: string,
    name: string,
  ): Promise<{ data: Uint8Array; mimeType: string; size: number } | null>;
}
