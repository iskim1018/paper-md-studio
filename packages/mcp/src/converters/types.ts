import type { DocumentFormat, HiddenExclusion } from "@paper-md-studio/core";

export type McpMode = "embedded" | "remote";

export interface ConverterInput {
  readonly bytes: Uint8Array;
  readonly originalName: string | null;
  /** 엑셀의 숨긴 시트·행·열을 변환에 포함 (기본: 제외 + 경고) */
  readonly includeHidden?: boolean;
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
  /** 변환은 됐지만 소비자가 알아야 할 사항 (스캔 PDF, 숨김 제외 등) */
  readonly warnings?: ReadonlyArray<string>;
  /** 숨김 제외 규모 (엑셀 전용, 제외된 게 있을 때만) */
  readonly hiddenExcluded?: HiddenExclusion;
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
