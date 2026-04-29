#!/usr/bin/env node
/**
 * OS별 sidecar 바이너리를 packages/app/src-tauri/binaries/ 로 복사한다.
 *
 * Tauri 의 externalBin 은 `<name>-<rust-triple>` 형식 파일을 기대한다.
 * - macOS Apple Silicon: paper-md-studio-cli-aarch64-apple-darwin (POSIX sh 래퍼)
 * - Windows x64:         paper-md-studio-cli-x86_64-pc-windows-msvc.exe (Rust 셰임 PE)
 *
 * Windows 는 `Command.sidecar(...)` 가 `CreateProcessW` 로 실행하므로 PE32+ 헤더를
 * 가진 진짜 .exe 가 필요하다. 과거에는 .cmd 배치 파일을 .exe 이름으로 복사했으나
 * "64비트 버전 Windows와 호환되지 않습니다" 오류가 발생했다 (PE 헤더 검증 실패).
 * 이제 packages/app/sidecar-shim/ 의 Rust 셰임을 cargo 로 빌드해 사용한다.
 *
 * macOS 는 PE 검증이 없으므로 기존 .sh 래퍼를 그대로 사용한다.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");
const scriptsDir = join(appRoot, "scripts");
const shimDir = join(appRoot, "sidecar-shim");
const binDir = join(appRoot, "src-tauri", "binaries");

mkdirSync(binDir, { recursive: true });

const platform = process.platform;
const arch = process.arch;

function buildWindowsShim() {
  const target = "x86_64-pc-windows-msvc";
  const manifest = join(shimDir, "Cargo.toml");
  if (!existsSync(manifest)) {
    throw new Error(`sidecar-shim crate 가 없습니다: ${manifest}`);
  }
  console.log(`Rust 셰임 빌드 중 (${target})...`);
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--release",
      "--manifest-path",
      manifest,
      "--target",
      target,
    ],
    { stdio: "inherit" },
  );
  if (result.error) {
    throw new Error(
      `cargo 실행 실패: ${result.error.message}\n` +
        "rustup 이 설치되어 있고 PATH 에 cargo 가 있는지 확인하세요.",
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `cargo build 실패 (exit ${result.status})\n` +
        `Windows 타겟이 설치되지 않았다면 \`rustup target add ${target}\` 를 먼저 실행하세요.`,
    );
  }
  return join(
    shimDir,
    "target",
    target,
    "release",
    "paper-md-studio-cli-shim.exe",
  );
}

function resolveTarget() {
  if (platform === "darwin" && arch === "arm64") {
    return {
      src: join(scriptsDir, "sidecar-wrapper.sh"),
      dest: join(binDir, "paper-md-studio-cli-aarch64-apple-darwin"),
      chmod: 0o755,
    };
  }
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    // arm64 Windows 는 아직 공식 타겟 아님 — Phase 8+ 검토.
    // x64 윈도우 배포만 지원 (x86_64-pc-windows-msvc).
    const shimExe = buildWindowsShim();
    return {
      src: shimExe,
      dest: join(binDir, "paper-md-studio-cli-x86_64-pc-windows-msvc.exe"),
      chmod: 0o755,
    };
  }
  throw new Error(
    `지원하지 않는 플랫폼: ${platform}/${arch}. ` +
      "현재 지원: macOS arm64, Windows x64",
  );
}

function verifyPeHeader(path) {
  // PE 시그니처: 첫 2바이트 'MZ' (0x4D 0x5A).
  // .cmd/.bat 가 .exe 로 복사되는 회귀를 차단한다.
  const buf = Buffer.alloc(2);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, 2, 0);
  } finally {
    closeSync(fd);
  }
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error(
      `PE 검증 실패: ${path} 의 첫 바이트가 'MZ' 가 아닙니다 ` +
        `(0x${buf[0].toString(16)} 0x${buf[1].toString(16)}). ` +
        "Tauri 가 sidecar 를 실행할 수 없습니다.",
    );
  }
}

try {
  const target = resolveTarget();
  if (!existsSync(target.src)) {
    throw new Error(`소스 파일이 없습니다: ${target.src}`);
  }
  copyFileSync(target.src, target.dest);
  try {
    chmodSync(target.dest, target.chmod);
  } catch {
    // Windows 에서는 chmod 효과 없음 — 무시
  }
  // Windows 산출물은 PE 헤더 검증으로 ".cmd 를 .exe 로 복사" 회귀 차단
  if (platform === "win32") {
    verifyPeHeader(target.dest);
  }
  const size = statSync(target.dest).size;
  console.log(`sidecar 설치: ${target.dest} (${size} bytes)`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`sidecar 설치 실패: ${message}`);
  process.exit(1);
}
