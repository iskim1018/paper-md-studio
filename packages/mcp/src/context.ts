import type { StorageAdapter } from "@paper-md-studio/server";
import { LocalFsStorage } from "@paper-md-studio/server";
import type { McpConfig } from "./config.js";
import {
  type Converter,
  EmbeddedConverter,
  RemoteConverter,
} from "./converters/index.js";
import { createStderrLogger, type McpLogger } from "./logger.js";

export interface McpContext {
  readonly config: McpConfig;
  readonly converter: Converter;
  readonly logger: McpLogger;
}

export interface CreateContextOptions {
  readonly config: McpConfig;
  /** 테스트 주입용. embedded 모드에서만 사용. */
  readonly storage?: StorageAdapter;
  /** 테스트 주입용. */
  readonly converter?: Converter;
  readonly logger?: McpLogger;
}

export function createContext(options: CreateContextOptions): McpContext {
  const logger = options.logger ?? createStderrLogger(options.config.logLevel);
  const converter = options.converter ?? buildConverter(options, logger);
  return {
    config: options.config,
    converter,
    logger,
  };
}

function buildConverter(
  options: CreateContextOptions,
  logger: McpLogger,
): Converter {
  if (options.config.mode === "remote") {
    if (!options.config.restUrl) {
      throw new Error("remote 모드에서 restUrl 이 설정되지 않았습니다.");
    }
    return new RemoteConverter({
      baseUrl: options.config.restUrl,
      ...(options.config.apiKey ? { apiKey: options.config.apiKey } : {}),
      timeoutMs: options.config.fetchTimeoutMs,
    });
  }
  const storage =
    options.storage ?? new LocalFsStorage({ root: options.config.storageRoot });
  return new EmbeddedConverter({ storage, logger });
}
