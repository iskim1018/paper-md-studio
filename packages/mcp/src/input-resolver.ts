import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { normalizePath } from "@paper-md-studio/core";
import { parseContentDispositionFilename } from "@paper-md-studio/server";

export interface ResolveInputArgs {
  readonly path?: string;
  readonly url?: string;
  readonly base64?: string;
  readonly mime?: string;
  readonly filename?: string;
}

export interface ResolvedInput {
  readonly bytes: Uint8Array;
  readonly originalName: string | null;
  readonly mime: string | null;
  readonly source: "path" | "url" | "base64";
}

export interface ResolveInputOptions {
  readonly maxUploadMb: number;
  readonly fetchImpl?: typeof fetch;
}

export async function resolveInput(
  args: ResolveInputArgs,
  options: ResolveInputOptions,
): Promise<ResolvedInput> {
  const limitBytes = options.maxUploadMb * 1024 * 1024;

  if (args.path) {
    return resolveFromPath(args, limitBytes);
  }
  if (args.url) {
    return resolveFromUrl(args, limitBytes, options.fetchImpl ?? fetch);
  }
  if (args.base64) {
    return resolveFromBase64(args, limitBytes);
  }
  throw new Error("path, url, base64 중 하나는 반드시 지정해야 합니다.");
}

async function resolveFromPath(
  args: ResolveInputArgs,
  limitBytes: number,
): Promise<ResolvedInput> {
  if (!args.path) {
    throw new Error("path 값이 비어 있습니다.");
  }
  const normalized = normalizePath(args.path);
  const info = await stat(normalized);
  if (!info.isFile()) {
    throw new Error(`파일이 아닙니다: ${args.path}`);
  }
  if (info.size > limitBytes) {
    throw new Error(
      `파일이 최대 업로드 한도(${toMb(limitBytes)}MB)를 초과했습니다: ${toMb(info.size)}MB`,
    );
  }
  const buf = await readFile(normalized);
  return {
    bytes: new Uint8Array(buf),
    originalName: args.filename ?? basename(normalized),
    mime: args.mime ?? null,
    source: "path",
  };
}

const SUPPORTED_EXTS = new Set([".hwp", ".hwpx", ".doc", ".docx", ".pdf"]);

async function resolveFromUrl(
  args: ResolveInputArgs,
  limitBytes: number,
  fetchImpl: typeof fetch,
): Promise<ResolvedInput> {
  if (!args.url) {
    throw new Error("url 값이 비어 있습니다.");
  }
  const res = await fetchImpl(args.url);
  if (!res.ok) {
    throw new Error(`URL 다운로드 실패 (${res.status}): ${args.url}`);
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > limitBytes) {
      throw new Error(
        `URL 응답이 최대 업로드 한도(${toMb(limitBytes)}MB)를 초과했습니다: ${toMb(size)}MB`,
      );
    }
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > limitBytes) {
    throw new Error(
      `URL 응답이 최대 업로드 한도(${toMb(limitBytes)}MB)를 초과했습니다: ${toMb(buf.byteLength)}MB`,
    );
  }

  // 파일명 우선순위: 사용자 힌트 > Content-Disposition > URL path basename.
  // data.go.kr 같은 다운로드 엔드포인트는 URL path 에 확장자가 없고 CD 헤더에 진짜 이름이 담김.
  const hint = args.filename?.trim() || null;
  const cdName = parseContentDispositionFilename(
    res.headers.get("content-disposition"),
  );
  const urlPathName = extractUrlPathName(args.url);
  const candidates: Array<string> = [];
  if (hint) candidates.push(hint);
  if (cdName) candidates.push(cdName);
  if (urlPathName) candidates.push(urlPathName);

  const chosen = pickBestCandidate(candidates);

  return {
    bytes: new Uint8Array(buf),
    originalName: chosen,
    mime: args.mime ?? res.headers.get("content-type"),
    source: "url",
  };
}

function extractUrlPathName(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname);
    if (name.length === 0) return null;
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  } catch {
    return null;
  }
}

function pickBestCandidate(candidates: ReadonlyArray<string>): string | null {
  for (const c of candidates) {
    if (SUPPORTED_EXTS.has(extname(c).toLowerCase())) {
      return c;
    }
  }
  return candidates[0] ?? null;
}

function resolveFromBase64(
  args: ResolveInputArgs,
  limitBytes: number,
): ResolvedInput {
  if (!args.base64) {
    throw new Error("base64 값이 비어 있습니다.");
  }
  const buf = Buffer.from(args.base64, "base64");
  if (buf.byteLength === 0) {
    throw new Error("base64 디코딩 결과가 비어 있습니다.");
  }
  if (buf.byteLength > limitBytes) {
    throw new Error(
      `base64 데이터가 최대 업로드 한도(${toMb(limitBytes)}MB)를 초과했습니다: ${toMb(buf.byteLength)}MB`,
    );
  }
  return {
    bytes: new Uint8Array(buf),
    originalName: args.filename ?? null,
    mime: args.mime ?? null,
    source: "base64",
  };
}

function toMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}
