import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  type ConvertOptions,
  type ConvertResult,
  convert as coreConvert,
  type DocumentFormat,
} from "@paper-md-studio/core";
import { sha256Hex } from "../storage/conversion-id.js";
import type { StorageAdapter, StoredMeta } from "../storage/types.js";

export interface ConvertCacheLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export interface ConvertCacheOptions {
  readonly storage: StorageAdapter;
  readonly tmpDir?: string;
  readonly logger?: ConvertCacheLogger;
  /** 테스트/주입용 — 기본값은 @paper-md-studio/core의 convert */
  readonly convertImpl?: (options: ConvertOptions) => Promise<ConvertResult>;
}

export interface ConvertCacheInput {
  readonly bytes: Uint8Array;
  readonly originalName: string | null;
  readonly format?: DocumentFormat;
}

export interface ConvertCacheResult {
  readonly meta: StoredMeta;
  readonly markdown: string;
  readonly cached: boolean;
  readonly elapsedMs: number;
}

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  ".hwp": "hwp",
  ".hwpx": "hwpx",
  ".doc": "doc",
  ".docx": "docx",
  ".pdf": "pdf",
};

const FORMAT_TO_EXT: Record<DocumentFormat, string> = {
  hwp: ".hwp",
  hwpx: ".hwpx",
  doc: ".doc",
  docx: ".docx",
  pdf: ".pdf",
};

function detectFormat(
  originalName: string | null,
  override: DocumentFormat | undefined,
): DocumentFormat {
  if (override) {
    return override;
  }
  if (originalName) {
    const ext = extname(originalName).toLowerCase();
    const format = EXT_TO_FORMAT[ext];
    if (format) {
      return format;
    }
  }
  throw new Error(
    "파일 포맷을 추정할 수 없습니다. originalName 에 확장자를 포함하거나 format 옵션을 지정하세요.",
  );
}

export class ConvertCache {
  private readonly storage: StorageAdapter;
  private readonly tmpDir: string;
  private readonly logger: ConvertCacheLogger | undefined;
  private readonly convertImpl: (
    options: ConvertOptions,
  ) => Promise<ConvertResult>;

  constructor(options: ConvertCacheOptions) {
    this.storage = options.storage;
    this.tmpDir = options.tmpDir ?? tmpdir();
    this.logger = options.logger;
    this.convertImpl = options.convertImpl ?? coreConvert;
  }

  async convert(input: ConvertCacheInput): Promise<ConvertCacheResult> {
    const format = detectFormat(input.originalName, input.format);
    const sha = sha256Hex(input.bytes);
    const start = performance.now();

    if (await this.storage.has(sha)) {
      const meta = await this.storage.getMeta(sha);
      const markdown = await this.storage.getMarkdown(sha);
      if (meta && markdown !== null) {
        const elapsedMs = performance.now() - start;
        this.logger?.info({
          event: "cache.hit",
          cached: true,
          sha,
          format: meta.format,
          elapsedMs,
        });
        return { meta, markdown, cached: true, elapsedMs };
      }
    }

    const workDir = await mkdtemp(join(this.tmpDir, "paper-md-convert-"));
    const fileName = safeInputFileName(input.originalName, format);
    const inputPath = join(workDir, fileName);

    try {
      await writeFile(inputPath, input.bytes);
      const converted = await this.convertImpl({ inputPath });

      const meta = await this.storage.put({
        sha256: sha,
        format: converted.format,
        markdown: converted.markdown,
        images: converted.images,
        elapsed: converted.elapsed,
        originalName: input.originalName,
        size: input.bytes.byteLength,
      });

      const elapsedMs = performance.now() - start;
      this.logger?.info({
        event: "cache.miss",
        cached: false,
        sha,
        format: meta.format,
        elapsedMs,
      });

      return {
        meta,
        markdown: converted.markdown,
        cached: false,
        elapsedMs,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

function safeInputFileName(
  originalName: string | null,
  format: DocumentFormat,
): string {
  const ext = FORMAT_TO_EXT[format];
  if (originalName) {
    const sanitized = originalName.replace(/[^\w.\-가-힣]/g, "_");
    if (sanitized.toLowerCase().endsWith(ext)) {
      return sanitized;
    }
  }
  return `input${ext}`;
}
