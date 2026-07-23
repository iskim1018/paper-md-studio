/** 입력 문자열이 http(s) URL 인지 판별한다 */
export function isHttpUrl(input: string): boolean {
  if (!/^https?:\/\//i.test(input)) {
    return false;
  }
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
