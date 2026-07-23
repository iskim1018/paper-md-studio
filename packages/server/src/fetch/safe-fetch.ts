// safe-fetch 구현은 HTML URL 변환에서도 재사용하기 위해
// @paper-md-studio/core (src/net/safe-fetch.ts) 로 승격됐다.
// 기존 import 경로 하위호환을 위해 여기서 re-export 한다.
export type {
  SafeFetchFail,
  SafeFetchOk,
  SafeFetchOptions,
  SafeFetchReason,
  SafeFetchResult,
} from "@paper-md-studio/core";
export { isBlockedIp, safeFetch } from "@paper-md-studio/core";
