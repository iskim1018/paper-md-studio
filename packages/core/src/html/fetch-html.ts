import type { lookup } from "node:dns/promises";
import { safeFetch } from "../net/safe-fetch.js";
import { decodeHtml } from "./decode-html.js";

/** 원격 HTML 최대 수신 크기 (20MB) */
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
/** 원격 HTML 요청 시간 제한 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** HTML로 취급하는 content-type */
const HTML_CONTENT_TYPES = /text\/html|application\/xhtml\+xml|text\/plain/i;

export interface FetchHtmlOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  /** 테스트 주입용 — 기본값은 global fetch */
  readonly fetchImpl?: typeof fetch;
  /** 테스트 주입용 — 기본값은 dns.lookup */
  readonly dnsLookup?: typeof lookup;
}

export interface FetchHtmlResult {
  readonly html: string;
  /** 리다이렉트 반영 후 최종 URL (상대 경로 절대화 기준) */
  readonly finalUrl: string;
}

/** URL에서 HTML을 안전하게 가져온다 (SSRF 가드 + charset 디코딩) */
export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions = {},
): Promise<FetchHtmlResult> {
  const result = await safeFetch(url, {
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.dnsLookup ? { dnsLookup: options.dnsLookup } : {}),
  });

  if (!result.ok) {
    throw new Error(`URL을 가져오지 못했습니다: ${result.message}`);
  }
  if (result.contentType && !HTML_CONTENT_TYPES.test(result.contentType)) {
    throw new Error(
      `HTML 문서가 아닙니다 (content-type: ${result.contentType})`,
    );
  }

  return {
    html: decodeHtml(result.bytes, result.contentType),
    finalUrl: result.finalUrl,
  };
}
