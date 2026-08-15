/** 지원하는 문서 포맷 */
export type DocumentFormat =
  | "hwp"
  | "hwpx"
  | "doc"
  | "docx"
  | "pdf"
  | "html"
  | "xlsx"
  | "xls";

/** HTML 변환 옵션 (로컬 .html 파일 또는 URL) */
export interface HtmlConvertOptions {
  /** Readability 기반 본문 추출 여부 — nav/sidebar/footer 제거 (기본: true) */
  extractContent?: boolean;
  /** headless 브라우저로 SPA 렌더링 후 변환 — URL 입력 전용 (기본: false) */
  renderSpa?: boolean;
  /** 상대 URL 절대화 기준 URL (로컬 파일 변환 시 지정) */
  baseUrl?: string;
  /** SPA 렌더링 시 추가로 대기할 CSS 셀렉터 */
  waitSelector?: string;
  /** 네트워크 요청·렌더링 시간 제한 (ms, 기본: 30000) */
  timeoutMs?: number;
  /** 원격 이미지를 다운로드해 {문서명}_images/로 저장 (기본: false — 원격 URL 유지) */
  downloadImages?: boolean;
}

/** XLSX 변환 옵션 */
export interface XlsxConvertOptions {
  /**
   * 숨긴 시트·행·열을 변환에 포함할지 여부 (기본: false).
   *
   * 숨김의 의도는 대외비 은닉일 수도, 열이 많아 접어둔 것일 수도 있어 문서만
   * 보고는 구분할 수 없다. 변환 결과는 공유되는 산출물이므로 기본은 제외이며,
   * 무엇이 빠졌는지는 경고로 알린다.
   */
  includeHidden?: boolean;
}

/**
 * 숨김 처리로 변환에서 제외된 항목 수 (XLSX 전용).
 *
 * 경고 메시지와 별도로 두는 이유는, UI가 "포함해서 다시 변환" 버튼을 띄울지
 * 판단할 때 한국어 문구를 파싱하게 만들면 안 되기 때문이다. 문구는 바뀌어도
 * 이 값의 의미는 바뀌지 않는다.
 */
export interface HiddenExclusion {
  /** 제외된 숨긴 시트 수 */
  sheets: number;
  /** 제외된 숨긴 행 수 (전 시트 합계) */
  rows: number;
  /** 제외된 숨긴 열 수 (전 시트 합계) */
  cols: number;
}

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
  /** 입력 파일 경로 또는 http(s) URL */
  inputPath: string;
  /** 출력 디렉토리 (미지정 시 입력 파일과 같은 디렉토리) */
  outputDir?: string;
  /** 이미지 저장 디렉토리명 (기본: {문서명}_images) */
  imagesDirName?: string;
  /** HTML 변환 옵션 (html 포맷에서만 사용) */
  html?: HtmlConvertOptions;
  /** XLSX 변환 옵션 (xlsx 포맷에서만 사용) */
  xlsx?: XlsxConvertOptions;
}

/** 파서가 반환하는 중간 결과 */
export interface ParseResult {
  /** HTML 문자열 (HTML 기반 파서) 또는 null */
  html: string | null;
  /** 직접 생성된 Markdown (PDF 등 HTML 거치지 않는 경우) */
  markdown: string | null;
  /** 추출된 이미지 */
  images: Array<ImageAsset>;
  /** 파싱 중 발생한 경고 (한국어 메시지) */
  warnings?: Array<string>;
  /** 숨김 처리로 제외된 항목 수 (XLSX 전용, 제외된 게 있을 때만) */
  hiddenExcluded?: HiddenExclusion;
}

/** 파서에 전달되는 옵션 */
export interface ParseOptions {
  /** 이미지 저장 디렉토리명 (MD 내 상대경로 생성용) */
  imagesDirName: string;
  /** HTML 변환 옵션 (html 포맷에서만 사용) */
  html?: HtmlConvertOptions;
  /** XLSX 변환 옵션 (xlsx 포맷에서만 사용) */
  xlsx?: XlsxConvertOptions;
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
  /** 변환 중 발생한 경고 (한국어 메시지) */
  warnings?: Array<string>;
  /** 숨김 처리로 제외된 항목 수 (XLSX 전용, 제외된 게 있을 때만) */
  hiddenExcluded?: HiddenExclusion;
}
