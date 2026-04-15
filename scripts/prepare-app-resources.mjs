#!/usr/bin/env node
/**
 * 배포 빌드 전 app/src-tauri/resources/ 디렉토리에 필요한 모든 파일을
 * 최종 배치한다. JRE, Node, jar는 각자 별도 스크립트에서 이미 생성된
 * 상태여야 하며, 여기서는 CLI 번들을 복사한다.
 *
 * 실행 순서:
 *   1. pnpm build (core/cli/app 기본 빌드)
 *   2. pnpm build:hwp-tool (Maven으로 jar 생성)
 *   3. pnpm build:jre (jlink)
 *   4. pnpm build:node (Node 런타임 다운로드)
 *   5. pnpm build:cli-bundle (tsup로 단일 파일 CLI 생성)
 *   6. [이 스크립트] CLI 번들을 resources/cli로 복사
 */
import {
  copyFileSync,
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
  assertExists(
    join(resourcesDir, "jre.tar.gz"),
    "먼저 'pnpm build:jre'를 실행하세요.",
  );
  assertExists(
    join(resourcesDir, "hwp-to-hwpx.jar"),
    "먼저 'pnpm build:hwp-tool' + 'pnpm build:jre'를 실행하세요 (jar는 build:jre가 복사함).",
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

  // 요약
  console.log(`\n=== app/src-tauri/resources 구성 ===`);
  console.log(`  jre.tar.gz             (번들 JRE, 첫 실행 시 추출)`);
  console.log(`  hwp-to-hwpx.jar        (HWP → HWPX 변환 툴)`);
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
