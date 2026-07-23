import { defineConfig } from "tsup";

export default defineConfig((options) => {
  const isBundle = process.env.BUILD_BUNDLE === "1";

  return {
    entry: ["src/index.ts"],
    // ESM 단일 포맷. 배포 번들은 모든 deps를 inline하지만 ESM이라서
    // CJS 의존성(mammoth, pdf2md 등)의 dynamic require('fs')를 위해
    // createRequire shim을 banner로 주입한다. 또한 core의 import.meta.url
    // 을 유지하기 위해서도 ESM이 필요.
    format: "esm",
    clean: false,
    noExternal: isBundle ? [/.*/] : undefined,
    // playwright-core는 optionalDependency (SPA 렌더링 전용).
    // 사이드카 번들 비대화를 막기 위해 항상 external 처리 — 미설치
    // 환경에서는 renderSpa의 동적 import가 한국어 에러로 안내한다.
    external: ["playwright-core"],
    minify: isBundle,
    outDir: isBundle ? "dist-bundle" : "dist",
    splitting: false,
    platform: "node",
    target: "node20",
    banner: isBundle
      ? {
          js: [
            "import { createRequire as __papermd_createRequire } from 'node:module';",
            "const require = __papermd_createRequire(import.meta.url);",
          ].join("\n"),
        }
      : undefined,
    ...options,
  };
});
