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
    // playwright-core는 optionalDependency (SPA 렌더링 전용) — 번들 비대화
    // 방지로 제외. @firecrawl/pdf-inspector는 NAPI 로더가 전 플랫폼
    // `require('./*.node')`를 갖고 있어 esbuild 정적 해석이 깨지므로 external
    // 로 두고, 배포는 prepare-app-resources가 로더+바이너리를 리소스의 미니
    // node_modules 로 동봉한다. 로드 실패 시 pdf-parser가 pdf2md로 폴백.
    // noExternal이 external보다 우선하므로 정규식에서 명시적으로 빼야 한다.
    noExternal: isBundle
      ? [/^(?!playwright-core$|@firecrawl\/pdf-inspector$).*/]
      : undefined,
    external: ["playwright-core", "@firecrawl/pdf-inspector"],
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
