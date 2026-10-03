/**
 * .hwp 변환 경로의 오류 분류와 한국어 메시지.
 *
 * rhwp(WASM)는 오류를 `Error`가 아니라 **평문 문자열**로 던지고, 문구에 자기
 * 이름("현재 rhwp는 …")이나 내부 API 힌트("parse_document_with_password …")를
 * 섞는다. 그대로 흘리면 서버는 Error 가 아니라서 일반 메시지로 뭉개고(REST),
 * 사용자는 쓸 수 없는 API 안내를 보게 된다. 그래서 .hwp 경로에서 밖으로 나가는
 * 모든 오류는 이 모듈을 거쳐 `HwpConversionError`(코드 + 한국어 메시지)가 된다.
 */

export type HwpErrorCode =
  | "EMPTY"
  | "UNSUPPORTED"
  | "LEGACY_VERSION"
  | "ENCRYPTED"
  | "DRM_PROTECTED"
  | "CORRUPTED"
  | "TOO_LARGE"
  | "XLS_MISNAMED"
  | "HWPML_VERSION"
  | "CONVERSION_FAILED";

/** 코드별 기본 안내 문구. 세부 내용은 괄호로 덧붙인다. */
export const HWP_ERROR_MESSAGES: Readonly<Record<HwpErrorCode, string>> = {
  EMPTY: "입력 파일이 비어 있습니다.",
  UNSUPPORTED: "한글 문서(.hwp)가 아니거나 지원하지 않는 형식입니다.",
  LEGACY_VERSION:
    "지원하지 않는 옛 한글 문서 버전입니다. 한글에서 .hwp(5.0) 또는 .hwpx로 다시 저장해주세요.",
  ENCRYPTED:
    "암호로 보호된 문서입니다. 한글에서 암호를 해제해 저장한 뒤 다시 시도해주세요.",
  DRM_PROTECTED:
    "DRM(문서 보안)으로 보호된 문서입니다. 보안 프로그램에서 보호를 해제해 저장하거나 원본 작성 기관에 일반 문서를 요청해주세요.",
  CORRUPTED: "문서 파일이 손상되어 읽을 수 없습니다.",
  TOO_LARGE:
    "압축을 풀면 비정상적으로 커지는 데이터가 있어 변환을 중단했습니다. 문서가 손상되었거나 악의적으로 만들어졌을 수 있습니다.",
  XLS_MISNAMED:
    "엑셀(.xls) 파일입니다. 확장자를 .xls로 바꾼 뒤 다시 시도해주세요.",
  HWPML_VERSION:
    "지원하지 않는 HWPML 버전입니다. 한글에서 .hwp 또는 .hwpx로 다시 저장해주세요.",
  CONVERSION_FAILED: "문서 변환에 실패했습니다.",
};

export class HwpConversionError extends Error {
  readonly code: HwpErrorCode;

  constructor(code: HwpErrorCode, detail?: string) {
    const base = HWP_ERROR_MESSAGES[code];
    super(detail ? `${base} (${detail})` : base);
    this.name = "HwpConversionError";
    this.code = code;
  }
}

/** rhwp 오류 문자열 앞머리 — 사용자에게는 군더더기라 떼어낸다 */
export const RHWP_INVALID_FILE_PREFIX = "유효하지 않은 파일: ";

/** rhwp 가 문서 구조를 못 읽었을 때 쓰는 "<영역> 오류: " 접두어 → 손상 */
const CORRUPTED_PREFIXES: ReadonlyArray<string> = [
  "CFB 오류",
  "HWP 3.0 오류",
  "HML 오류",
  "헤더 오류",
  "FileHeader 읽기 오류",
  "DocInfo 오류",
  "DocInfo IO 오류",
  "DocInfo 레코드 오류",
  "DocInfo 파싱 오류",
  "BodyText 오류",
  "BodyText 레코드 오류",
  "BodyText 파싱 오류",
  "레코드 IO 오류",
  "HWPX 오류",
  "HWPX ZIP 오류",
  "HWPX XML 오류",
  "ZIP 오류",
  "XML 파싱 오류",
  "DATA 크기 오류",
];

/** rhwp 문자열 오류 패턴 → 코드. 계약 테스트가 이 문구들을 실제 rhwp로 고정한다 */
export const RHWP_PATTERNS = {
  emptyFile: "오류코드: EMPTY_FILE",
  unsupportedFormat: "오류코드: UNSUPPORTED_FILE_FORMAT",
  drmProtected: "오류코드: DRM_PROTECTED",
  passwordRequired: "비밀번호가 필요한 암호 문서",
  passwordMismatch: "비밀번호가 일치하지 않",
  hwpmlVersion: /지원하지 않는 HWPML 버전입니다: ?(.*)$/,
} as const;

/** 사용자에게 보여주면 안 되는 내부 정보(엔진 이름·API 이름) */
const INTERNAL_DETAIL = /rhwp|[a-z]+_[a-z_]+/i;

/** 세부 내용에서 접두어를 떼고, 내부 정보가 섞였으면 통째로 버린다 */
export function sanitizeDetail(raw: string): string | undefined {
  const trimmed = raw.startsWith(RHWP_INVALID_FILE_PREFIX)
    ? raw.slice(RHWP_INVALID_FILE_PREFIX.length)
    : raw;
  const detail = trimmed.trim();
  if (detail.length === 0 || INTERNAL_DETAIL.test(detail)) {
    return undefined;
  }
  return detail;
}

/** `WebAssembly.RuntimeError` (core 의 lib 설정에는 WebAssembly 타입이 없어 이름으로 본다) */
export function isWasmRuntimeError(err: unknown): boolean {
  return err instanceof Error && err.name === "RuntimeError";
}

/** rhwp 문자열 오류를 코드로 분류한다 */
function classifyRhwpMessage(message: string): HwpConversionError {
  if (message.includes(RHWP_PATTERNS.emptyFile)) {
    return new HwpConversionError("EMPTY");
  }
  if (message.includes(RHWP_PATTERNS.drmProtected)) {
    return new HwpConversionError("DRM_PROTECTED");
  }
  if (message.includes(RHWP_PATTERNS.unsupportedFormat)) {
    return new HwpConversionError("UNSUPPORTED");
  }
  if (
    message.includes(RHWP_PATTERNS.passwordRequired) ||
    message.includes(RHWP_PATTERNS.passwordMismatch)
  ) {
    return new HwpConversionError("ENCRYPTED");
  }
  const version = RHWP_PATTERNS.hwpmlVersion.exec(message);
  if (version) {
    return new HwpConversionError(
      "HWPML_VERSION",
      `문서 버전: ${version[1] || "없음"}`,
    );
  }
  const detail = sanitizeDetail(message);
  const body = message.startsWith(RHWP_INVALID_FILE_PREFIX)
    ? message.slice(RHWP_INVALID_FILE_PREFIX.length)
    : message;
  if (CORRUPTED_PREFIXES.some((prefix) => body.startsWith(prefix))) {
    return new HwpConversionError("CORRUPTED", detail);
  }
  return new HwpConversionError("CONVERSION_FAILED", detail);
}

/**
 * rhwp 호출에서 잡힌 무엇이든(문자열·Error·WASM 트랩) `HwpConversionError` 로 바꾼다.
 *
 * - 이미 `HwpConversionError` 면 그대로 둔다 (사전 검사가 던진 것).
 * - `WebAssembly.RuntimeError`(unreachable·메모리 부족 등)는 영어 문구라 세부를
 *   싣지 않는다 — 엔진 내부 패닉이며 손상·과대 문서가 주원인이다.
 * - 그 밖의 `Error`(예: 해제된 문서 접근 "null pointer passed to rust")도 내부
 *   사정이므로 일반 실패로만 알린다.
 */
export function toHwpConversionError(err: unknown): HwpConversionError {
  if (err instanceof HwpConversionError) {
    return err;
  }
  if (typeof err === "string") {
    return classifyRhwpMessage(err);
  }
  if (isWasmRuntimeError(err)) {
    return new HwpConversionError(
      "CONVERSION_FAILED",
      "변환 엔진 내부 오류 — 문서가 손상되었거나 너무 클 수 있습니다",
    );
  }
  return new HwpConversionError("CONVERSION_FAILED");
}
