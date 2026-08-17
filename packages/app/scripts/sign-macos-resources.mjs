#!/usr/bin/env node
/**
 * 번들 리소스 안의 Mach-O 바이너리를 Developer ID 로 서명한다.
 *
 * Tauri 는 .app 바깥 껍데기만 서명하고 `Contents/Resources/` 안에 복사된
 * 네이티브 바이너리는 건드리지 않는다. 공증(notarization)은 아카이브 안의
 * 모든 Mach-O 를 검사하므로, 서명되지 않은 것이 하나라도 있으면 아카이브
 * 전체가 거부된다 (v0.6.0 1차 시도 실패):
 *
 *   pdf-inspector.darwin-arm64.node
 *     - The binary is not signed with a valid Developer ID certificate.
 *     - The signature does not include a secure timestamp.
 *
 * NAPI 바이너리는 배포될 때 **ad-hoc(linker-signed)** 상태다. `codesign
 * --verify` 는 통과하므로 "서명 여부"만 보면 놓친다 — 발급 기관이 Developer
 * ID 인지까지 봐야 한다.
 *
 * 번들된 Node(OpenJS 서명)는 이미 Developer ID 서명이라 건드리지 않는다.
 * JRE 는 tar.gz 안에 있어 공증 검사 대상이 아니다 (그래서 지금껏 통과했다).
 *
 * `tauri.conf.json` 의 `beforeBundleCommand` 로 호출된다 — 이 시점이면
 * tauri-action 이 인증서를 키체인에 올리고 `APPLE_SIGNING_IDENTITY` 를
 * 내보낸 뒤다. 서명한 파일이 .app 안으로 복사되어도 Mach-O 안에 들어 있는
 * 서명은 그대로 살아남는다.
 *
 * macOS 가 아니거나 서명 신원이 없으면(로컬 개발 빌드) 조용히 지나간다.
 */
import { spawnSync } from "node:child_process";
import { openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RESOURCES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "resources",
);

/** Mach-O 매직 (thin 32/64비트, universal fat, 각 엔디안) */
const MACHO_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
]);

function isMachO(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(4);
    if (readSync(fd, head, 0, 4, 0) < 4) return false;
    return MACHO_MAGICS.has(head.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      yield path;
    }
  }
}

/** 이미 Developer ID 로 서명돼 있으면 건드리지 않는다 (ad-hoc 은 서명으로 치지 않는다) */
function hasDeveloperIdSignature(path) {
  const result = spawnSync("codesign", ["-dvvv", path], { encoding: "utf-8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return output.includes("Authority=Developer ID Application:");
}

function sign(path, identity) {
  const result = spawnSync(
    "codesign",
    [
      "--force",
      "--timestamp",
      "--options",
      "runtime",
      "--sign",
      identity,
      path,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`서명 실패: ${path}`);
  }
}

if (process.platform !== "darwin") {
  process.exit(0);
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (!identity) {
  console.log(
    "APPLE_SIGNING_IDENTITY 가 없어 리소스 서명을 건너뜁니다 (서명 없는 로컬 빌드).",
  );
  process.exit(0);
}

let signed = 0;
let skipped = 0;
for (const path of walk(RESOURCES_DIR)) {
  if (!isMachO(path)) continue;
  if (hasDeveloperIdSignature(path)) {
    skipped += 1;
    continue;
  }
  console.log(`서명: ${path}`);
  sign(path, identity);
  signed += 1;
}

console.log(
  `리소스 Mach-O 서명 완료 — ${signed}개 서명, ${skipped}개 건너뜀(이미 Developer ID).`,
);
