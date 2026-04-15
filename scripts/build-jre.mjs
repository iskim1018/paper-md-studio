#!/usr/bin/env node
/**
 * jlink로 HWP 변환용 최소 JRE를 생성한다.
 *
 * 출력 경로: packages/app/src-tauri/resources/jre/
 * 이 디렉토리는 Tauri bundle.resources에 포함되어 설치관리자에 번들된다.
 *
 * 주의:
 * - jlink는 현재 OS/아키텍처용 네이티브 JRE만 생성한다 (크로스 타겟팅 X).
 * - macOS에서 실행하면 macOS용 JRE, Windows에서 실행하면 Windows용 JRE.
 * - CI matrix에서 각 OS별로 이 스크립트를 돌려 배포 아티팩트를 만든다.
 *
 * 필요:
 * - JDK 17+ (jlink 포함)
 * - 환경변수 JAVA_HOME 또는 시스템 PATH의 jlink
 */
import { execSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const appResourcesDir = join(
  repoRoot,
  "packages",
  "app",
  "src-tauri",
  "resources",
);
const jreOutputDir = join(appResourcesDir, "jre");
const coreJarPath = join(
  repoRoot,
  "packages",
  "core",
  "resources",
  "hwp-to-hwpx.jar",
);
const appJarPath = join(appResourcesDir, "hwp-to-hwpx.jar");

// hwp2hwpx가 필요로 하는 최소 JDK 모듈 세트.
// - java.base: 필수
// - java.logging: Log 사용
// - java.xml: XML 파싱 (HWPX가 XML 기반)
// - java.desktop: 일부 이미지/폰트 처리 API 대응 (AWT 최소)
// - java.naming: Java 확장 기능 호환
// - java.scripting: 일부 의존성 대비
const MODULES = [
  "java.base",
  "java.logging",
  "java.xml",
  "java.desktop",
  "java.naming",
  "java.scripting",
].join(",");

function findJlink() {
  const javaHome = process.env.JAVA_HOME;
  const exe = process.platform === "win32" ? "jlink.exe" : "jlink";
  if (javaHome) {
    const candidate = join(javaHome, "bin", exe);
    if (existsSync(candidate)) return candidate;
  }
  // PATH 탐색
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = execSync(`${cmd} ${exe}`, { encoding: "utf-8" }).trim();
    if (result) return result.split("\n")[0];
  } catch {
    // fall through
  }
  throw new Error(
    "jlink를 찾을 수 없습니다. JAVA_HOME 환경변수를 설정하거나 " +
      "JDK 17+를 PATH에 추가해주세요.",
  );
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getDirectorySize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  }
  return total;
}

async function main() {
  const jlinkPath = findJlink();
  console.log(`jlink: ${jlinkPath}`);
  console.log(`출력: ${jreOutputDir}`);
  console.log(`플랫폼: ${process.platform}/${process.arch}`);
  console.log(`모듈: ${MODULES}`);

  if (existsSync(jreOutputDir)) {
    console.log("기존 JRE 디렉토리 삭제...");
    rmSync(jreOutputDir, { recursive: true, force: true });
  }

  // --compress=2 = zip compression (JDK 17 문법).
  // JDK 21+는 --compress=zip-9 문법이지만 우선 17 호환성 유지.
  const args = [
    "--add-modules",
    MODULES,
    "--strip-debug",
    "--no-man-pages",
    "--no-header-files",
    "--compress=2",
    "--output",
    jreOutputDir,
  ];

  console.log(`\n실행: jlink ${args.join(" ")}\n`);

  const result = spawnSync(jlinkPath, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    console.error(`jlink 실패: exit ${result.status}`);
    process.exit(1);
  }

  const size = getDirectorySize(jreOutputDir);
  console.log(`\n✓ JRE 생성 완료: ${formatBytes(size)}`);
  console.log(`  ${jreOutputDir}`);

  // hwp-to-hwpx.jar를 app resources로 복사 (Tauri bundle.resources가 여기를 가리킴)
  if (existsSync(coreJarPath)) {
    mkdirSync(appResourcesDir, { recursive: true });
    copyFileSync(coreJarPath, appJarPath);
    const jarSize = statSync(appJarPath).size;
    console.log(`\n✓ hwp-to-hwpx.jar 복사: ${formatBytes(jarSize)}`);
    console.log(`  ${appJarPath}`);
  } else {
    console.warn(
      `\n⚠ ${coreJarPath}가 없습니다. 먼저 'pnpm build:hwp-tool'을 실행하세요.`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
