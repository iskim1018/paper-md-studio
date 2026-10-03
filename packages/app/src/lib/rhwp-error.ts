/**
 * rhwp 오류를 사용자에게 보일 한국어 문장으로 바꾼다.
 *
 * rhwp 는 대부분의 오류를 Error 가 아니라 **문자열**로 던진다. 그대로 두면
 * `err instanceof Error` 검사에서 떨어져 "알 수 없는 오류"만 남고, 문자열을
 * 그대로 보이면 "parse_document_with_password 로 비밀번호를 전달하세요" 같은
 * 개발자용 안내가 사용자에게 새어 나간다. 변환 경로(core `parsers/hwp/errors.ts`)와
 * 같은 기준으로 흔한 경우를 다듬는다.
 */

import { HWPML_VERSION_REJECTION } from "@paper-md-studio/md-utils";

const INVALID_FILE_PREFIX = "유효하지 않은 파일: ";

const KNOWN_CAUSES: ReadonlyArray<{
  readonly match: RegExp;
  readonly message: string;
}> = [
  {
    match: /비밀번호가 필요한 암호 문서|비밀번호가 일치하지 않/,
    message:
      "암호로 보호된 문서는 미리 볼 수 없습니다. 한글에서 암호를 해제해 저장한 뒤 다시 열어주세요.",
  },
  {
    match: /DRM_PROTECTED/,
    message: "DRM(문서 보안)으로 보호된 문서는 미리 볼 수 없습니다.",
  },
  { match: /EMPTY_FILE/, message: "빈 파일입니다." },
  {
    match: /UNSUPPORTED_FILE_FORMAT/,
    message: "한글 문서가 아니거나 지원하지 않는 형식입니다.",
  },
];

function rawMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "";
}

/** rhwp 가 던진 값(문자열·Error·기타)을 사용자용 한국어 메시지로 */
export function describeRhwpError(err: unknown): string {
  const raw = rawMessage(err).trim();
  if (raw === "") return "알 수 없는 오류";

  const known = KNOWN_CAUSES.find((cause) => cause.match.test(raw));
  if (known) return known.message;

  // 버전을 바꿔 다시 열어도 안 된 HWPML (HEAD 없음 등) — 변환 경로와 같은 안내
  const version = HWPML_VERSION_REJECTION.exec(raw);
  if (version) {
    return `지원하지 않는 HWPML 버전입니다(${version[1] || "없음"}). 한글에서 .hwp 또는 .hwpx로 다시 저장해주세요.`;
  }

  // 개발자용 괄호 안내("(parse_… 로 …)")와 앞머리를 걷어낸다
  return raw
    .replace(INVALID_FILE_PREFIX, "")
    .replace(/\s*\([^)]*parse_[^)]*\)/g, "")
    .trim();
}
