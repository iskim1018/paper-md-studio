import { readFile } from "node:fs/promises";
import type { FileType } from "kordoc";
import { detectFormat, parse } from "kordoc";
import type {
  ImageAsset,
  ParseOptions,
  ParseResult,
  Parser,
} from "../types.js";
import { normalizeHtmlTablesToGfm } from "./html-tables-to-gfm.js";
import { canonicalizeGlyphs, normalizePuaSymbols } from "./pua-symbols.js";

/** kordoc ParseFailure의 구조화 에러 코드 → 한국어 안내 메시지 */
const ERROR_MESSAGES: Record<string, string> = {
  EMPTY_INPUT: "입력 파일이 비어 있습니다.",
  UNSUPPORTED_FORMAT: "지원하지 않는 문서 형식입니다.",
  ENCRYPTED:
    "암호로 보호된 문서입니다. 한글/오피스에서 암호를 해제한 뒤 다시 시도해주세요.",
  DRM_PROTECTED:
    "DRM(배포용 문서 보안)으로 보호된 문서입니다. 원본 작성 기관에 일반 문서를 요청해주세요.",
  CORRUPTED: "문서 파일이 손상되어 읽을 수 없습니다.",
  DECOMPRESSION_BOMB:
    "비정상적으로 큰 압축 데이터가 감지되어 변환을 중단했습니다.",
  ZIP_BOMB: "비정상적으로 큰 압축 데이터가 감지되어 변환을 중단했습니다.",
  IMAGE_BASED_PDF:
    "텍스트 없이 이미지로만 구성된 PDF입니다. 텍스트를 추출할 수 없습니다.",
  NO_SECTIONS: "문서에서 본문 섹션을 찾을 수 없습니다.",
  PARSE_ERROR: "문서 구조를 해석하지 못했습니다.",
  MISSING_DEPENDENCY: "변환에 필요한 구성 요소가 설치되어 있지 않습니다.",
  OUTPUT_TOO_LARGE: "변환 결과가 너무 커서 출력할 수 없습니다.",
};

/** kordoc 실패 결과를 한국어 에러 메시지로 변환한다. */
export function failureMessage(
  code: string | undefined,
  error: string,
): string {
  const known = code ? ERROR_MESSAGES[code] : undefined;
  if (known) {
    return `${known} (${error})`;
  }
  return `문서 변환에 실패했습니다: ${error}`;
}

/**
 * kordoc 마크다운의 이미지 참조(파일명 직접 참조)를
 * 프로젝트 규약(./{문서명}_images/파일명)의 상대경로로 재작성한다.
 */
export function rewriteImageRefs(
  markdown: string,
  imageNames: ReadonlyArray<string>,
  imagesDirName: string,
): string {
  let result = markdown;
  for (const name of imageNames) {
    result = result.replaceAll(`](${name})`, `](./${imagesDirName}/${name})`);
  }
  return result;
}

interface KordocImage {
  readonly filename: string;
  readonly data: Uint8Array;
  readonly mimeType: string;
}

/** kordoc ExtractedImage[] → 프로젝트 ImageAsset[] 매핑 */
export function toImageAssets(
  images: ReadonlyArray<KordocImage>,
): Array<ImageAsset> {
  return images.map((img) => ({
    name: img.filename,
    data: img.data,
    mimeType: img.mimeType,
  }));
}

interface KordocWarning {
  readonly page?: number;
  readonly message: string;
}

/** kordoc ParseWarning[] → 한국어 경고 문자열 목록 */
export function toWarningMessages(
  warnings: ReadonlyArray<KordocWarning>,
): Array<string> {
  return warnings.map((w) =>
    w.page !== undefined ? `${w.page}쪽: ${w.message}` : w.message,
  );
}

/** Buffer를 kordoc detectFormat이 요구하는 ArrayBuffer로 변환한다. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * 매직바이트 기반 포맷 감지 (kordoc detectFormat 위임).
 * 확장자가 .hwp인 파일이 실제로는 HWP 5.x(OLE2)·HWP 3.x·HWPML(XML)
 * 셋 중 하나일 수 있어, 파서 라우팅 전 실제 포맷을 판별하는 데 쓴다.
 */
export function detectBinaryFormat(buffer: Buffer): FileType {
  return detectFormat(toArrayBuffer(buffer));
}

/**
 * 오프라인 기본값을 강제한다.
 * kordoc의 아웃바운드 통신(OCR 모델 다운로드·watch webhook)은
 * KORDOC_OFFLINE=1이면 요청 발신 전에 차단된다.
 * 사용자가 명시적으로 값을 설정한 경우는 존중한다.
 */
export function ensureOfflineDefault(): void {
  if (process.env.KORDOC_OFFLINE === undefined) {
    process.env.KORDOC_OFFLINE = "1";
  }
}

/**
 * kordoc 기반 파서 어댑터.
 * XLSX·XLS·HWP 3.x·HWPML 등 kordoc에 위임하는 포맷의 공용 진입점이다.
 * 포맷 판별은 kordoc의 매직바이트 감지에 맡긴다.
 */
export interface KordocParserOptions {
  /**
   * kordoc이 낸 HTML 표를 GFM으로 내릴지 여부 (K3 W2).
   *
   * HWP5에서 시작해 XLSX·XLS(2026-08-15, 이후 자체 파서로 대체), HWP3·HWPML
   * (2026-08-16, HWPML 합성 병합 표가 HTML로 나오는 것을 실측)까지 확대 —
   * kordoc을 쓰는 모든 경로가 켠다. 기본값을 끔으로 유지하는 이유는 직접
   * 생성자를 호출하는 테스트·외부 사용처의 출력을 조용히 바꾸지 않기 위해서다.
   */
  readonly normalizeTables?: boolean;
}

export class KordocParser implements Parser {
  constructor(private readonly parserOptions: KordocParserOptions = {}) {}

  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    ensureOfflineDefault();
    const buffer = await readFile(inputPath);
    const result = await parse(buffer);

    if (!result.success) {
      throw new Error(failureMessage(result.code, result.error));
    }

    const images = toImageAssets(result.images ?? []);
    const rewritten = rewriteImageRefs(
      result.markdown,
      images.map((img) => img.name),
      options.imagesDirName,
    );
    // 표 정규화는 이미지 참조 재작성 뒤에 온다 — 셀 안 이미지 경로도 함께
    // 고쳐진 상태로 GFM 에 실려야 한다.
    //
    // 글리프 정규화 2단: kordoc은 PUA 48개를 스스로 매핑하지만 우리 매핑에만
    // 있는 코드가 남고(normalizePuaSymbols), 겹치는 코드도 고른 글자가 다르다
    // (canonicalizeGlyphs — ◻→□, ✔→✓). 같은 체크박스가 .hwp로 열 때와
    // .hwpx로 열 때 달라 보이면 안 되므로 둘 다 태운다.
    const markdown = this.parserOptions.normalizeTables
      ? canonicalizeGlyphs(
          normalizePuaSymbols(normalizeHtmlTablesToGfm(rewritten)),
        )
      : rewritten;

    const warnings = toWarningMessages(result.warnings ?? []);

    return {
      html: null,
      markdown,
      images,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
