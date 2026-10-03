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
    // @rhwp/core(.hwp 변환 WASM)도 external — 글루(rhwp.js)와 rhwp_bg.wasm 은
    // 같은 빌드여야 하므로(import 이름에 해시가 박힘) 패키지 디렉토리째로
    // 미니 node_modules 에 동봉하고, core 가 .hwp 를 만날 때만 지연 로드한다.
    // noExternal이 external보다 우선하므로 정규식에서 명시적으로 빼야 한다.
    noExternal: isBundle
      ? [/^(?!playwright-core$|@firecrawl\/pdf-inspector$|@rhwp\/core$).*/]
      : undefined,
    external: ["playwright-core", "@firecrawl/pdf-inspector", "@rhwp/core"],
    minify: isBundle,
    // 법적 주석(`@license`·`/*!`)을 번들 끝에 모은다. esbuild 의 번들 기본값과
    // 같지만, 인라인한 파생 코드(core 의 hwp-equation: kordoc MIT·
    // hml-equation-parser Apache-2.0)의 저작권 표기가 배포물에 남는 유일한
    // 경로라 명시한다 — 기본값이 바뀌거나 옵션이 덮이면 고지가 조용히 사라진다.
    // 라이선스 전문은 bundle-runtime-deps 가 THIRD_PARTY_LICENSES.md 를 옆에 둔다.
    esbuildOptions(esbuild) {
      esbuild.legalComments = "eof";
    },
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
