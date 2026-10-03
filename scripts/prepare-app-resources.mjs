#!/usr/bin/env node
/**
 * 배포 빌드 전 app/src-tauri/resources/ 디렉토리에 필요한 모든 파일을
 * 최종 배치한다. Node 런타임은 별도 스크립트에서 이미 내려받은 상태여야
 * 하며, 여기서는 CLI 번들을 복사한다.
 *
 * 실행 순서:
 *   1. pnpm build (core/cli/app 기본 빌드)
 *   2. pnpm build:node (Node 런타임 다운로드)
 *   3. pnpm build:cli-bundle (tsup로 단일 파일 CLI 생성)
 *   4. [이 스크립트] CLI 번들을 resources/cli로 복사
 *
 * 복사가 끝난 리소스는 scripts/smoke-cli-bundle.mjs 가 번들 Node 로 실제
 * 변환까지 돌려 확인한다 (릴리스 워크플로).
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const resourcesDir = join(
  repoRoot,
  "packages",
  "app",
  "src-tauri",
  "resources",
);

const cliBundleSrc = join(
  repoRoot,
  "packages",
  "cli",
  "dist-bundle",
  "index.js",
);
const cliBundleDest = join(resourcesDir, "cli", "index.js");

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function assertExists(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`필수 파일이 없습니다: ${path}\n힌트: ${hint}`);
  }
}

function main() {
  // 사전 조건 검증
  assertExists(
    cliBundleSrc,
    "먼저 'pnpm build:cli-bundle'을 실행하세요.",
  );
  const nodeBinary =
    process.platform === "win32"
      ? join(resourcesDir, "node", "node.exe")
      : join(resourcesDir, "node", "bin", "node");
  assertExists(nodeBinary, "먼저 'pnpm build:node'를 실행하세요.");

  // CLI 번들 복사
  mkdirSync(dirname(cliBundleDest), { recursive: true });
  if (existsSync(cliBundleDest)) rmSync(cliBundleDest, { force: true });
  copyFileSync(cliBundleSrc, cliBundleDest);

  // index.js를 ESM으로 로드하도록 sentinel package.json을 함께 배치
  writeFileSync(
    join(dirname(cliBundleDest), "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  );

  const cliSize = statSync(cliBundleDest).size;
  console.log(`✓ CLI 번들 복사: ${formatBytes(cliSize)}`);
  console.log(`  ${cliBundleDest}`);

  // 런타임 미니 node_modules 복사.
  //
  // 번들에 인라인하지 않는 패키지(pdf-inspector NAPI 로더, .hwp 변환 엔진
  // @rhwp/core 의 글루·WASM)는 bundle-runtime-deps.mjs 가 dist-bundle 옆에
  // 구성해 둔다 — 여기서는 그 디렉토리를 통째로 배포 리소스에 복사한다.
  // WASM 이 빠지면 .hwp 변환만 런타임에 실패하므로 빌드 단계에서 막는다.
  const runtimeDepsSrc = join(dirname(cliBundleSrc), "node_modules");
  const bundleHint =
    "먼저 'pnpm build:cli-bundle'을 실행하세요 (bundle-runtime-deps.mjs 가 구성).";
  assertExists(
    join(runtimeDepsSrc, "@firecrawl", "pdf-inspector", "index.js"),
    bundleHint,
  );
  assertExists(join(runtimeDepsSrc, "@rhwp", "core", "rhwp_bg.wasm"), bundleHint);
  assertExists(join(runtimeDepsSrc, "@rhwp", "core", "rhwp.js"), bundleHint);
  const runtimeDepsDest = join(dirname(cliBundleDest), "node_modules");
  rmSync(runtimeDepsDest, { recursive: true, force: true });
  cpSync(runtimeDepsSrc, runtimeDepsDest, { recursive: true });
  console.log(`✓ 런타임 미니 node_modules 복사 (pdf-inspector, @rhwp/core)`);

  // 요약
  console.log(`\n=== app/src-tauri/resources 구성 ===`);
  console.log(`  node/${process.platform === "win32" ? "node.exe" : "bin/node"}          (번들 Node 런타임)`);
  console.log(`  cli/index.js           (번들 CLI)`);
  console.log(`\n이제 'pnpm --filter @paper-md-studio/app tauri build' 가능`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
