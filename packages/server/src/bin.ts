#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  // biome-ignore lint/suspicious/noConsole: bootstrap failure before logger
  console.error(error);
  process.exit(1);
});
