/**
 * macOS는 파일명을 NFD(Normalization Form Decomposition)로 저장하여
 * 한글이 자모 분리되는 문제가 발생합니다.
 * 이 모듈은 파일 경로를 NFC로 정규화하여 일관된 한글 파일명을 보장합니다.
 */

/** 문자열을 NFC(Normalization Form Composed)로 정규화 */
export function normalizeToNFC(str: string): string {
  return str.normalize("NFC");
}

/** 파일 경로를 NFC로 정규화 */
export function normalizePath(filePath: string): string {
  return normalizeToNFC(filePath);
}
