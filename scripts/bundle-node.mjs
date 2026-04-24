#!/usr/bin/env node
/**
 * Node.js 런타임 바이너리를 다운로드해 Tauri resources에 배치한다.
 *
 * 출력:
 *   packages/app/src-tauri/resources/node/bin/node[.exe]
 *
 * 현재 OS/arch용 바이너리만 내려받는다. CI matrix에서 각 플랫폼이
 * 스스로 실행해 해당 플랫폼용 Node를 준비한다.
 */
import { execSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const nodeDir = join(
  repoRoot,
  "packages",
  "app",
  "src-tauri",
  "resources",
  "node",
);

// Node LTS 고정 버전 (JDK 17과 비슷하게 LTS 선호)
const NODE_VERSION = "v20.18.0";

function resolveTarget() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") {
    return {
      label: "macOS arm64",
      archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
      format: "tar.gz",
      binary: "bin/node",
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      label: "Windows x64",
      archive: `node-${NODE_VERSION}-win-x64.zip`,
      format: "zip",
      binary: "node.exe",
    };
  }
  throw new Error(
    `지원하지 않는 플랫폼: ${platform}/${arch}. 현재 지원: macOS arm64, Windows x64`,
  );
}

async function download(url, destPath) {
  console.log(`다운로드: ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`다운로드 실패 (${res.status}): ${url}`);
  }
  const dest = createWriteStream(destPath);
  await pipeline(res.body, dest);
  console.log(`  저장: ${destPath}`);
}

async function main() {
  const target = resolveTarget();
  console.log(`플랫폼: ${target.label}`);
  console.log(`Node 버전: ${NODE_VERSION}`);
  console.log(`출력: ${nodeDir}`);

  if (existsSync(nodeDir)) {
    console.log("기존 node 디렉토리 삭제...");
    rmSync(nodeDir, { recursive: true, force: true });
  }
  mkdirSync(nodeDir, { recursive: true });

  const url = `https://nodejs.org/dist/${NODE_VERSION}/${target.archive}`;
  const archivePath = join(nodeDir, target.archive);
  await download(url, archivePath);

  console.log("\n추출 중...");
  if (target.format === "tar.gz") {
    // tar로 압축 해제 후 상위 디렉토리 한 단계 올리기
    execSync(`tar -xzf "${archivePath}" -C "${nodeDir}" --strip-components=1`, {
      stdio: "inherit",
    });
  } else {
    // Windows: unzip 사용 (Git Bash에 포함) 또는 powershell expand-archive
    execSync(
      `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${nodeDir}\\tmp' -Force"`,
      { stdio: "inherit", shell: true },
    );
    // 하위 디렉토리 한 단계 올리기
    execSync(
      `powershell -Command "Move-Item -Path '${nodeDir}\\tmp\\node-${NODE_VERSION}-win-x64\\*' -Destination '${nodeDir}' -Force; Remove-Item -Path '${nodeDir}\\tmp' -Recurse -Force"`,
      { stdio: "inherit", shell: true },
    );
  }

  // 아카이브 파일 삭제 (번들 크기 절약)
  rmSync(archivePath, { force: true });

  const binaryPath = join(nodeDir, target.binary);
  if (!existsSync(binaryPath)) {
    throw new Error(`Node 바이너리가 예상 위치에 없습니다: ${binaryPath}`);
  }

  // 배포에 불필요한 항목 제거 (크기 절약: ~160MB → ~50MB)
  // - include/: C++ native addon 헤더
  // - share/: 한국어/영어 manual, systemtap 등
  // - lib/: npm, corepack, node_modules (우리는 node 바이너리만 필요)
  // - CHANGELOG.md, README.md: 문서 (LICENSE는 attribution 용으로 유지)
  const PRUNE = ["include", "share", "lib", "CHANGELOG.md", "README.md"];
  for (const name of PRUNE) {
    const p = join(nodeDir, name);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }

  // macOS의 bin/에는 node 외에 corepack/npm/npx가 ../lib/로 symlink되어 있어
  // lib/ 삭제 후 dangling symlink가 된다. Tauri resource scanner가 이를
  // 오류로 간주하므로 명시적으로 제거.
  if (process.platform !== "win32") {
    const binDir = join(nodeDir, "bin");
    if (existsSync(binDir)) {
      for (const entry of readdirSync(binDir)) {
        if (entry !== "node") {
          rmSync(join(binDir, entry), { force: true });
        }
      }
    }
  }

  console.log(`\n✓ Node 런타임 준비 완료`);
  console.log(`  바이너리: ${binaryPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
