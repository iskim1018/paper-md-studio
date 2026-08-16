#!/usr/bin/env node
/**
 * CLI 번들(dist-bundle) 옆에 런타임 전용 미니 node_modules 를 구성한다.
 *
 * 번들에 인라인할 수 없어 실행 시점에 require 되는 패키지가 두 부류 있다.
 *   1. @firecrawl/pdf-inspector — NAPI 로더가 전 플랫폼 `require('./*.node')`
 *      분기를 갖고 있어 esbuild 정적 해석이 깨진다. external 로 두고 로더와
 *      현재 플랫폼 바이너리만 여기서 동봉한다.
 *   2. cfb (+ adler-32, crc-32) — kordoc dist 가 top-level 에서
 *      `createRequire(import.meta.url)("cfb")` 로 부른다. 동적 require 라
 *      esbuild 가 rewrite 하지 못해 번들 위치 기준 탐색으로 남는다.
 *
 * `pnpm build:cli-bundle` 의 tsup 직후 자동 실행되며, 산출물은
 * dist-bundle/node_modules/ 에 놓인다 — 개발 중 `node dist-bundle/index.js`
 * 직접 실행과 배포(prepare-app-resources 가 통째로 복사) 모두 이걸 쓴다.
 */
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const destRoot = join(
  repoRoot,
  "packages",
  "cli",
  "dist-bundle",
  "node_modules",
);

const coreRequire = createRequire(
  join(repoRoot, "packages", "core", "package.json"),
);

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

  // 2. cfb 계열 — kordoc 이 실제로 로드하는 버전을 kordoc 컨텍스트에서 해석
  const kordocRequire = createRequire(coreRequire.resolve("kordoc"));
  const cfbEntry = kordocRequire.resolve("cfb");
  const cfbRoot = packageRootOf(cfbEntry, "cfb");
  const cfbRequire = createRequire(join(cfbRoot, "package.json"));
  for (const name of ["cfb", "adler-32", "crc-32"]) {
    const entry = name === "cfb" ? cfbEntry : cfbRequire.resolve(name);
    const srcRoot = packageRootOf(entry, name);
    cpSync(srcRoot, join(destRoot, name), {
      recursive: true,
      dereference: true,
    });
    console.log(`✓ ${name}`);
  }

  console.log(`\n미니 node_modules 구성 완료: ${destRoot}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error("힌트: 'pnpm install' 후 다시 시도하세요.");
  process.exit(1);
}
