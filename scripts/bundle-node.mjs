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
import { createHash } from "node:crypto";
import {
  createReadStream,
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

// Node LTS 고정 버전 — 저장소 engines(>=22.13.0)와 같은 계열이어야 한다.
// 20.18 을 번들하던 동안 pdfjs 6(Node 22.13+ 요구)을 쓰는 PDF 대체 엔진이
// 사이드카에서 결과 없이 멈췄다(2026-10-03). 올릴 때는 아래 체크섬도 함께
// 바꾼다: https://nodejs.org/dist/<버전>/SHASUMS256.txt
const NODE_VERSION = "v22.23.3";

/**
 * 내려받은 압축 파일의 SHA-256 — 릴리스에 그대로 실리는 실행 파일이라 전송 중
 * 변조·미러 오염을 막는다. 값은 nodejs.org SHASUMS256.txt 에서 옮겼다.
 */
const ARCHIVE_SHA256 = {
  [`node-${NODE_VERSION}-darwin-arm64.tar.gz`]:
    "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53",
  [`node-${NODE_VERSION}-win-x64.zip`]:
    "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
};

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

/** 내려받은 압축 파일이 고정해 둔 SHA-256 과 같은지 확인한다 */
async function verifyChecksum(archivePath, archiveName) {
  const expected = ARCHIVE_SHA256[archiveName];
  if (!expected) {
    throw new Error(`체크섬이 고정되지 않은 파일입니다: ${archiveName}`);
  }
  const hash = createHash("sha256");
  await pipeline(createReadStream(archivePath), hash);
  const actual = hash.digest("hex");
  if (actual !== expected) {
    rmSync(archivePath, { force: true });
    throw new Error(
      `Node 압축 파일 체크섬이 다릅니다 (${archiveName}): 기대 ${expected}, 실제 ${actual}`,
    );
  }
  console.log(`  체크섬 확인: ${actual}`);
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
  await verifyChecksum(archivePath, target.archive);

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
