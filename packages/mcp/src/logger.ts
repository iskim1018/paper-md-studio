import type { McpConfig } from "./config.js";

export interface McpLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const LEVELS: Record<McpConfig["logLevel"], number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function createStderrLogger(level: McpConfig["logLevel"]): McpLogger {
  const threshold = LEVELS[level];

  function emit(
    lvl: keyof typeof LEVELS,
    obj: Record<string, unknown>,
    msg?: string,
  ): void {
    if (LEVELS[lvl] > threshold) {
      return;
    }
    const payload = {
      time: new Date().toISOString(),
      level: lvl,
      ...(msg ? { msg } : {}),
      ...obj,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    info: (obj, msg) => emit("info", obj, msg),
    warn: (obj, msg) => emit("warn", obj, msg),
    error: (obj, msg) => emit("error", obj, msg),
  };
}
