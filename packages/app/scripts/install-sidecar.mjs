#!/usr/bin/env node
/**
 * OS별 sidecar 래퍼를 packages/app/src-tauri/binaries/ 로 복사한다.
 *
 * Tauri의 externalBin은 `<name>-<rust-triple>` 형식 파일을 기대한다.
 * - macOS Apple Silicon: paper-md-studio-cli-aarch64-apple-darwin (POSIX sh)
 * - Windows x64:         paper-md-studio-cli-x86_64-pc-windows-msvc.exe (cmd)
 *                        실제 확장자는 .exe여야 Tauri가 Windows 배포 시 인식
 *                        → 배치를 .exe로 명명하거나 .cmd 심볼릭/래퍼 필요
 *
 * 초기 구현: 현재 OS에 해당하는 래퍼만 복사.
 */
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");
const scriptsDir = join(appRoot, "scripts");
const binDir = join(appRoot, "src-tauri", "binaries");

mkdirSync(binDir, { recursive: true });

const platform = process.platform;
const arch = process.arch;

function resolveTarget() {
  if (platform === "darwin" && arch === "arm64") {
    return {
      src: join(scriptsDir, "sidecar-wrapper.sh"),
      dest: join(binDir, "paper-md-studio-cli-aarch64-apple-darwin"),
      chmod: 0o755,
    };
  }
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    // Tauri는 Windows sidecar를 .exe로 기대하므로 .cmd 내용을 .exe 이름으로 배포.
    // 실제 실행은 cmd.exe가 처리하므로 동작 OK (extension 무시).
    // arm64 Windows는 아직 공식 타겟 아님 — Phase 8+ 검토.
    return {
      src: join(scriptsDir, "sidecar-wrapper.cmd"),
      dest: join(binDir, "paper-md-studio-cli-x86_64-pc-windows-msvc.exe"),
      chmod: 0o755,
    };
  }
  throw new Error(
    `지원하지 않는 플랫폼: ${platform}/${arch}. ` +
      "현재 지원: macOS arm64, Windows x64",
  );
}

try {
  const target = resolveTarget();
  copyFileSync(target.src, target.dest);
  try {
    chmodSync(target.dest, target.chmod);
  } catch {
    // Windows에서는 chmod 효과 없음 — 무시
  }
  console.log(`sidecar 설치: ${target.dest}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`sidecar 설치 실패: ${message}`);
  process.exit(1);
}
