import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/*/tests/**/*.test.ts"],
    exclude: ["**/tests/e2e/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/index.ts"],
    },
  },
});
