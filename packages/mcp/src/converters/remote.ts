import type {
  Converter,
  ConverterInput,
  ConverterOutput,
  McpMode,
} from "./types.js";

export interface RemoteConverterOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  /** 대용량 업로드 타임아웃 (ms). 기본 120000 (2분) */
  readonly timeoutMs?: number;
}

interface RestConvertData {
  conversionId: string;
  format: "hwp" | "hwpx" | "doc" | "docx" | "pdf";
  markdown: string;
  images: Array<{
    name: string;
    mimeType: string;
    size: number;
    url?: string;
    uri?: string;
  }>;
  cached: boolean;
  elapsedMs: number;
  createdAt: string;
  originalName: string | null;
  size: number;
}

interface RestEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class RemoteConverter implements Converter {
  public readonly mode: McpMode = "remote";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RemoteConverterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }

  /**
   * Remote 모드 convert — REST 서버에 multipart 로 bytes 업로드.
   * `images=refs` 쿼리로 호출해 이미지 URL 서명 없이 `conv://` URI 를 받도록 한다.
   */
  async convert(input: ConverterInput): Promise<ConverterOutput> {
    const boundary = `----papermdmcp${Math.random().toString(16).slice(2)}`;
    const body = buildMultipart(boundary, input.bytes, input.originalName);
    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    };
    const url = `${this.baseUrl}/v1/convert?images=refs`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers,
      body,
    });
    const data = await parseEnvelope<RestConvertData>(res);
    return restToOutput(data);
  }

  async getMarkdown(conversionId: string): Promise<string | null> {
    const url = `${this.baseUrl}/v1/conversions/${encodeURIComponent(conversionId)}`;
    const res = await this.fetchWithTimeout(url, { method: "GET" });
    if (res.status === 404) {
      return null;
    }
    const data = await parseEnvelope<RestConvertData>(res);
    return data.markdown;
  }

  async getImage(
    _conversionId: string,
    _name: string,
  ): Promise<{ data: Uint8Array; mimeType: string; size: number } | null> {
    // Remote 모드에서는 inline 이미지 모드를 지원하지 않는다 — 이미지 바이트를
    // 별도 signed URL 로 다운받는 플로우는 MVP 에 포함되지 않음.
    throw new Error(
      "Remote 모드는 inline 이미지 모드를 지원하지 않습니다. images=refs 또는 images=omit 를 사용하세요.",
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildMultipart(
  boundary: string,
  bytes: Uint8Array,
  originalName: string | null,
): Uint8Array {
  const filename = originalName ?? "upload.bin";
  const headerText = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${escapeFilename(filename)}"`,
    "Content-Type: application/octet-stream",
    "",
    "",
  ].join("\r\n");
  const trailerText = `\r\n--${boundary}--\r\n`;
  const header = Buffer.from(headerText, "utf-8");
  const trailer = Buffer.from(trailerText, "utf-8");
  const out = new Uint8Array(
    header.byteLength + bytes.byteLength + trailer.byteLength,
  );
  out.set(header, 0);
  out.set(bytes, header.byteLength);
  out.set(trailer, header.byteLength + bytes.byteLength);
  return out;
}

function escapeFilename(name: string): string {
  // multipart filename 은 ASCII 권장. 한글은 그대로 UTF-8 바이트로 나가며 Fastify 가 받음.
  return name.replace(/"/g, "");
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `원격 서버가 JSON 이 아닌 응답을 반환했습니다 (${res.status} ${res.statusText}): ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as RestEnvelope<T>;
  if (!res.ok || body.success === false) {
    throw new Error(
      body.error ?? `원격 서버 오류 (${res.status}): ${res.statusText}`,
    );
  }
  if (!body.data) {
    throw new Error("원격 서버 응답에 data 필드가 없습니다.");
  }
  return body.data;
}

function restToOutput(data: RestConvertData): ConverterOutput {
  return {
    conversionId: data.conversionId,
    format: data.format,
    markdown: data.markdown,
    images: data.images.map((img) => ({
      name: img.name,
      mimeType: img.mimeType,
      size: img.size,
    })),
    cached: data.cached,
    elapsedMs: data.elapsedMs,
    originalName: data.originalName,
    size: data.size,
  };
}
