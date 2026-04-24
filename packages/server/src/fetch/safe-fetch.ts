import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SafeFetchReason =
  | "scheme-blocked"
  | "host-blocked"
  | "too-large"
  | "timeout"
  | "redirect-loop"
  | "http-error"
  | "network-error";

export interface SafeFetchOk {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
  readonly contentDisposition: string | null;
  readonly finalUrl: string;
}

export interface SafeFetchFail {
  readonly ok: false;
  readonly reason: SafeFetchReason;
  readonly status?: number;
  readonly message: string;
}

export type SafeFetchResult = SafeFetchOk | SafeFetchFail;

export interface SafeFetchOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects?: number;
  readonly allowedSchemes?: ReadonlyArray<string>;
  /** 테스트 주입용 — 기본값은 global fetch */
  readonly fetchImpl?: typeof fetch;
  /** 테스트 주입용 — 기본값은 dns.lookup */
  readonly dnsLookup?: typeof lookup;
}

interface ResolvedOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly allowedSchemes: ReadonlyArray<string>;
  readonly fetchImpl: typeof fetch;
  readonly dnsLookup: typeof lookup;
}

const DEFAULT_ALLOWED_SCHEMES: ReadonlyArray<string> = ["http:", "https:"];
const DEFAULT_MAX_REDIRECTS = 3;

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const opts: ResolvedOptions = {
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    allowedSchemes: options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES,
    fetchImpl: options.fetchImpl ?? fetch,
    dnsLookup: options.dnsLookup ?? lookup,
  };

  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      reason: "host-blocked",
      message: `URL 형식이 올바르지 않습니다: ${rawUrl}`,
    };
  }

  for (let hop = 0; hop <= opts.maxRedirects; hop += 1) {
    const guard = await validateUrl(currentUrl, opts);
    if (!guard.ok) {
      return guard;
    }

    const res = await performFetch(currentUrl, opts);
    if (!res.ok) {
      return res;
    }

    if (isRedirect(res.response.status)) {
      const location = res.response.headers.get("location");
      if (!location) {
        return {
          ok: false,
          reason: "http-error",
          status: res.response.status,
          message: `${res.response.status} 응답이지만 Location 헤더가 없습니다.`,
        };
      }
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        return {
          ok: false,
          reason: "host-blocked",
          message: `리다이렉트 대상 URL 이 올바르지 않습니다: ${location}`,
        };
      }
      continue;
    }

    if (!res.response.ok) {
      return {
        ok: false,
        reason: "http-error",
        status: res.response.status,
        message: `원격 서버 오류: ${res.response.status} ${res.response.statusText}`,
      };
    }

    return readBody(res.response, currentUrl, opts.maxBytes);
  }

  return {
    ok: false,
    reason: "redirect-loop",
    message: `리다이렉트 횟수 한도(${opts.maxRedirects})를 초과했습니다.`,
  };
}

async function validateUrl(
  url: URL,
  opts: ResolvedOptions,
): Promise<{ ok: true } | SafeFetchFail> {
  if (!opts.allowedSchemes.includes(url.protocol)) {
    return {
      ok: false,
      reason: "scheme-blocked",
      message: `허용되지 않은 스킴입니다: ${url.protocol}`,
    };
  }

  const host = url.hostname;
  if (host.length === 0) {
    return {
      ok: false,
      reason: "host-blocked",
      message: "호스트가 비어 있습니다.",
    };
  }

  const literal =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const literalVersion = isIP(literal);
  if (literalVersion !== 0) {
    if (isBlockedIp(literal)) {
      return {
        ok: false,
        reason: "host-blocked",
        message: `사설·loopback·link-local 대역 IP 는 차단됩니다: ${literal}`,
      };
    }
    return { ok: true };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await opts.dnsLookup(host, { all: true });
  } catch (err: unknown) {
    return {
      ok: false,
      reason: "host-blocked",
      message: `호스트 해석 실패: ${host} (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  if (addresses.length === 0) {
    return {
      ok: false,
      reason: "host-blocked",
      message: `호스트 해석 결과가 없습니다: ${host}`,
    };
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) {
      return {
        ok: false,
        reason: "host-blocked",
        message: `호스트 ${host} 가 차단된 IP (${addr.address}) 로 해석됩니다.`,
      };
    }
  }

  return { ok: true };
}

async function performFetch(
  url: URL,
  opts: ResolvedOptions,
): Promise<{ ok: true; response: Response } | SafeFetchFail> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await opts.fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
    });
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const declared = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        return {
          ok: false,
          reason: "too-large",
          message: `Content-Length(${declared}) 가 허용 크기(${opts.maxBytes}) 를 초과합니다.`,
        };
      }
    }
    return { ok: true, response };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        reason: "timeout",
        message: `요청이 시간 제한(${opts.timeoutMs}ms) 을 초과했습니다.`,
      };
    }
    return {
      ok: false,
      reason: "network-error",
      message: `네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(
  response: Response,
  url: URL,
  maxBytes: number,
): Promise<SafeFetchResult> {
  const body = response.body;
  if (!body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return {
        ok: false,
        reason: "too-large",
        message: `수신 크기(${buf.byteLength}) 가 한도(${maxBytes}) 를 초과했습니다.`,
      };
    }
    return {
      ok: true,
      bytes: buf,
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition"),
      finalUrl: url.toString(),
    };
  }

  const reader = body.getReader();
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // cancellation best-effort
          }
          return {
            ok: false,
            reason: "too-large",
            message: `수신 크기가 한도(${maxBytes}) 를 초과했습니다.`,
          };
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // lock may already be released
    }
  }

  const merged = concatChunks(chunks, total);
  return {
    ok: true,
    bytes: merged,
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
    finalUrl: url.toString(),
  };
}

function concatChunks(
  chunks: ReadonlyArray<Uint8Array>,
  total: number,
): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

export function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedIpv4(address);
  }
  if (version === 6) {
    return isBlockedIpv6(address);
  }
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10));
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    return true;
  }
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  // 0.0.0.0/8 (current network, unspecified)
  if (a === 0) {
    return true;
  }
  // 10.0.0.0/8
  if (a === 10) {
    return true;
  }
  // 127.0.0.0/8 (loopback)
  if (a === 127) {
    return true;
  }
  // 169.254.0.0/16 (link-local; AWS/GCP metadata)
  if (a === 169 && b === 254) {
    return true;
  }
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  // 192.168.0.0/16
  if (a === 192 && b === 168) {
    return true;
  }
  // 198.18.0.0/15 (benchmarking)
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  // 224.0.0.0/4 (multicast)
  if (a >= 224 && a <= 239) {
    return true;
  }
  // 240.0.0.0/4 (reserved) + 255.255.255.255 (broadcast)
  if (a >= 240) {
    return true;
  }
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  // Unspecified (::) and loopback (::1)
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  // IPv4-mapped / IPv4-compatible (::ffff:a.b.c.d)
  if (normalized.startsWith("::ffff:") || normalized.startsWith("::0:ffff:")) {
    const ipv4 = normalized.split(":").pop();
    if (ipv4 && isIP(ipv4) === 4) {
      return isBlockedIpv4(ipv4);
    }
    return true;
  }
  // Unique local (fc00::/7) — fc00..fdff
  if (
    /^fc[0-9a-f]{2}:/.test(normalized) ||
    /^fd[0-9a-f]{2}:/.test(normalized)
  ) {
    return true;
  }
  // Link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) {
    return true;
  }
  // Multicast (ff00::/8)
  if (normalized.startsWith("ff")) {
    return true;
  }
  return false;
}
