#!/usr/bin/env node
/**
 * CLI 번들(dist-bundle) 옆에 런타임 전용 미니 node_modules 를 구성한다.
 *
 * 번들에 인라인하지 않고 실행 시점에 불러오는 패키지가 두 부류 있다.
 *   1. @firecrawl/pdf-inspector — NAPI 로더가 전 플랫폼 `require('./*.node')`
 *      분기를 갖고 있어 esbuild 정적 해석이 깨진다. external 로 두고 로더와
 *      현재 플랫폼 바이너리만 여기서 동봉한다.
 *   2. @rhwp/core — .hwp 변환 엔진(Rust→WASM). 글루(rhwp.js)와 rhwp_bg.wasm
 *      은 같은 빌드여야 하므로(WASM import 이름에 해시가 박힘) 패키지째로
 *      동봉한다. core 는 `createRequire(import.meta.url).resolve(
 *      "@rhwp/core/rhwp_bg.wasm")` 로 번들 위치 기준에서 WASM 을 찾는다.
 *      WASM 은 플랫폼 무관이라 플랫폼별 분기가 없다.
 *
 * cfb 는 xls-parser 가 정적으로 import 해 번들에 인라인되므로 따로 두지
 * 않는다 (예전에는 kordoc 의 동적 require 때문에 여기서 동봉했다).
 *
 * 저장소 루트의 THIRD_PARTY_LICENSES.md 도 번들 옆(dist-bundle/)에 둔다.
 * 번들은 minify 되어 소스 머리말이 사라지고 `@license` 주석의 저작권 줄만
 * 끝에 남는다 — 인라인한 코드(수식 변환기의 kordoc MIT·hml-equation-parser
 * Apache-2.0 등)의 라이선스 전문은 이 파일로 함께 배포한다 (Apache-2.0 §4(a):
 * 목적 코드 수령자에게 라이선스 사본).
 *
 * `pnpm build:cli-bundle` 의 tsup 직후 자동 실행되며, 산출물은
 * dist-bundle/node_modules/ 에 놓인다 — 개발 중 `node dist-bundle/index.js`
 * 직접 실행과 배포(prepare-app-resources 가 통째로 복사) 모두 이걸 쓴다.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const bundleDir = join(repoRoot, "packages", "cli", "dist-bundle");
const destRoot = join(bundleDir, "node_modules");

/** 번들 옆에 둘 서드파티 라이선스 고지 (전문 포함) */
const LICENSE_NOTICES = "THIRD_PARTY_LICENSES.md";

const coreRequire = createRequire(
  join(repoRoot, "packages", "core", "package.json"),
);

/** @rhwp/core 에서 실행에 필요한 파일 (MIT LICENSE 는 재배포 고지용) */
const RHWP_FILES = ["rhwp.js", "rhwp_bg.wasm", "package.json", "LICENSE"];

/** 진입 파일 경로에서 패키지 루트로 올라간다 (…/node_modules/<name>/…) */
function packageRootOf(entryPath, name) {
  const marker = join("node_modules", ...name.split("/"));
  const idx = entryPath.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(`패키지 루트를 찾을 수 없습니다: ${name} (${entryPath})`);
  }
  return entryPath.slice(0, idx + marker.length);
}

function main() {
  rmSync(destRoot, { recursive: true, force: true });

  // 1. pdf-inspector — 로더 + 현재 플랫폼 바이너리만 (전체 복사는 불필요)
  const napiTriple =
    process.platform === "win32" ? "win32-x64-msvc" : "darwin-arm64";
  const loaderSrc = coreRequire.resolve("@firecrawl/pdf-inspector");
  // 플랫폼 패키지는 로더의 의존이라 로더 컨텍스트에서만 해석된다
  const nativeSrc = createRequire(loaderSrc).resolve(
    `@firecrawl/pdf-inspector-${napiTriple}`,
  );
  const inspectorDest = join(destRoot, "@firecrawl", "pdf-inspector");
  mkdirSync(inspectorDest, { recursive: true });
  copyFileSync(loaderSrc, join(inspectorDest, "index.js"));
  writeFileSync(
    join(inspectorDest, "package.json"),
    `${JSON.stringify({ name: "@firecrawl/pdf-inspector", main: "index.js" }, null, 2)}\n`,
  );
  copyFileSync(
    nativeSrc,
    join(inspectorDest, `pdf-inspector.${napiTriple}.node`),
  );
  console.log(`✓ @firecrawl/pdf-inspector (로더 + ${napiTriple})`);

  // 2. @rhwp/core — 글루·WASM·package.json(type: module, main)·LICENSE
  const rhwpEntry = coreRequire.resolve("@rhwp/core");
  const rhwpRoot = packageRootOf(rhwpEntry, "@rhwp/core");
  const rhwpDest = join(destRoot, "@rhwp", "core");
  mkdirSync(rhwpDest, { recursive: true });
  for (const file of RHWP_FILES) {
    copyFileSync(join(rhwpRoot, file), join(rhwpDest, file));
  }
  console.log(`✓ @rhwp/core (${RHWP_FILES.join(", ")})`);

  // 3. 서드파티 라이선스 고지 — 번들에 인라인한 코드의 저작권·라이선스 전문
  copyFileSync(join(repoRoot, LICENSE_NOTICES), join(bundleDir, LICENSE_NOTICES));
  console.log(`✓ ${LICENSE_NOTICES}`);

  console.log(`\n미니 node_modules 구성 완료: ${destRoot}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error("힌트: 'pnpm install' 후 다시 시도하세요.");
  process.exit(1);
}
