import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import {
  ConvertCache,
  type ConvertCacheLogger,
  type StorageAdapter,
} from "@paper-md-studio/server";
import type {
  Converter,
  ConverterInput,
  ConverterOutput,
  McpMode,
} from "./types.js";

export interface EmbeddedConverterOptions {
  readonly storage: StorageAdapter;
  readonly logger?: ConvertCacheLogger;
  /** 테스트 주입용 — core.convert 대체 */
  readonly convertImpl?: (options: ConvertOptions) => Promise<ConvertResult>;
}

export class EmbeddedConverter implements Converter {
  public readonly mode: McpMode = "embedded";
  private readonly storage: StorageAdapter;
  private readonly cache: ConvertCache;

  constructor(options: EmbeddedConverterOptions) {
    this.storage = options.storage;
    this.cache = new ConvertCache({
      storage: options.storage,
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.convertImpl ? { convertImpl: options.convertImpl } : {}),
    });
  }

  async convert(input: ConverterInput): Promise<ConverterOutput> {
    const result = await this.cache.convert({
      bytes: input.bytes,
      originalName: input.originalName,
    });
    return {
      conversionId: result.meta.conversionId,
      format: result.meta.format,
      markdown: result.markdown,
      images: result.meta.images.map((img) => ({
        name: img.name,
        mimeType: img.mimeType,
        size: img.size,
      })),
      cached: result.cached,
      elapsedMs: result.elapsedMs,
      originalName: result.meta.originalName,
      size: result.meta.size,
    };
  }

  async getMarkdown(conversionId: string): Promise<string | null> {
    return this.storage.getMarkdown(conversionId);
  }

  async getImage(conversionId: string, name: string) {
    const img = await this.storage.getImage(conversionId, name);
    return img
      ? { data: img.data, mimeType: img.mimeType, size: img.size }
      : null;
  }
}
