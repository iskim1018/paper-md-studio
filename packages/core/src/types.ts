/** 지원하는 문서 포맷 */
export type DocumentFormat = "hwpx" | "docx" | "pdf";

/** 변환 시 추출된 이미지 */
export interface ImageAsset {
  /** 이미지 파일명 (예: img_001.png) */
  name: string;
  /** 이미지 바이너리 데이터 */
  data: Uint8Array;
  /** MIME 타입 (예: image/png) */
  mimeType: string;
}

/** 변환 옵션 */
export interface ConvertOptions {
  /** 입력 파일 경로 */
  inputPath: string;
  /** 출력 디렉토리 (미지정 시 입력 파일과 같은 디렉토리) */
  outputDir?: string;
  /** 이미지 저장 디렉토리명 (기본: {문서명}_images) */
  imagesDirName?: string;
}

/** 파서가 반환하는 중간 결과 */
export interface ParseResult {
  /** HTML 문자열 (HTML 기반 파서) 또는 null */
  html: string | null;
  /** 직접 생성된 Markdown (PDF 등 HTML 거치지 않는 경우) */
  markdown: string | null;
  /** 추출된 이미지 */
  images: Array<ImageAsset>;
}

/** 파서에 전달되는 옵션 */
export interface ParseOptions {
  /** 이미지 저장 디렉토리명 (MD 내 상대경로 생성용) */
  imagesDirName: string;
}

/** 포맷별 파서 인터페이스 */
export interface Parser {
  parse(inputPath: string, options: ParseOptions): Promise<ParseResult>;
}

/** 변환 결과 */
export interface ConvertResult {
  /** 변환된 Markdown 문자열 */
  markdown: string;
  /** 추출된 이미지 목록 */
  images: Array<ImageAsset>;
  /** 원본 파일 포맷 */
  format: DocumentFormat;
  /** 변환 소요 시간 (ms) */
  elapsed: number;
}
