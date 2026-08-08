#!/usr/bin/env node
/**
 * K3 — HWP 5.x A/B 비교 스크립트 (docs/kordoc-integration.md §6 참조)
 *
 * 같은 .hwp를 (a) 현행 Java 툴체인(→HWPX→자체 파서), (b) kordoc 직파싱으로
 * 각각 변환해 나란히 저장하고 요약을 출력한다. 사전에 `pnpm build` 필요.
 *
 * pdf-ab.mjs와 달리 kordoc을 직접 호출하지 않고 두 경로 모두 core의
 * convert()를 통과시킨다. 이미지 참조 재작성·경고 배선까지 포함한 실제
 * 통합 결과를 비교해야 "Java를 걷어낼 수 있는가"에 답할 수 있기 때문이다.
 *
 * 사용법:
 *   node scripts/hwp-ab.mjs <hwp파일-또는-디렉토리>... [-o <출력디렉토리>]
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.KORDOC_OFFLINE ??= "1";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { convert } = await import(join(REPO, "packages/core/dist/index.js"));

const HWP_ENGINE_ENV = "PAPER_MD_STUDIO_HWP_ENGINE";

// ─── 인자 파싱 ───────────────────────────────────────────
const args = process.argv.slice(2);
const outFlag = args.indexOf("-o");
// 기본 출력은 개인 장비 전용 폴더(gitignore) 안. 입력이 비공개 문서면 변환
// 결과도 비공개이므로, 지정을 잊어도 저장소 밖으로 새지 않는다.
const outDir =
  outFlag >= 0 ? resolve(args[outFlag + 1]) : resolve("private/hwp-ab");
// outFlag가 -1(=-o 없음)이면 outFlag+1이 0이 되어 첫 인자(입력)를 지워버린다.
const inputs = args.filter(
  (_, i) => outFlag < 0 || (i !== outFlag && i !== outFlag + 1),
);

if (inputs.length === 0) {
  console.error(
    "사용법: node scripts/hwp-ab.mjs <hwp파일-또는-디렉토리>... [-o <출력디렉토리>]",
  );
  process.exit(1);
}

const hwpPaths = [];
for (const input of inputs) {
  const s = await stat(input);
  if (s.isDirectory()) {
    for (const f of await readdir(input)) {
      if (extname(f).toLowerCase() === ".hwp") hwpPaths.push(join(input, f));
    }
  } else {
    hwpPaths.push(input);
  }
}

await mkdir(outDir, { recursive: true });

// ─── 지표 ────────────────────────────────────────────────
function countTableRows(md) {
  return md.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
}
function countTables(md) {
  // separator 행(|---|---|) 개수 = GFM 표 개수 근사
  return md.split("\n").filter((l) => /^\s*\|[\s:|-]+\|\s*$/.test(l)).length;
}
function countHeadings(md) {
  return md.split("\n").filter((l) => /^#{1,6}\s/.test(l)).length;
}

/**
 * 체크박스·불릿 글리프 분포와 잔존 PUA 문자를 센다.
 *
 * 두 엔진 모두 PUA(U+F0xx)를 정규화하지만 고르는 글자가 다르다 —
 * 2026-08-08 실측: U+F0A8이 자체 파서는 □(U+25A1), kordoc은 ◻(U+25FB),
 * U+F0FC가 각각 ✓(U+2713)/✔(U+2714). 같은 체크박스가 입력 경로에 따라
 * 달라 보이는 문제라 수치로 남긴다.
 */
const GLYPHS = ["■", "□", "◻", "☑", "☒", "✓", "✔", "✗", "●", "○", "▪", "➢"];
function glyphCensus(md) {
  const census = {};
  for (const g of GLYPHS) {
    const n = md.split(g).length - 1;
    if (n > 0) census[g] = n;
  }
  const pua = md.match(/[-]|[\u{F0000}-\u{FFFFD}]/gu);
  if (pua) census["PUA잔존"] = pua.length;
  return census;
}

/** 한쪽에만 있는 줄 수 — 내용 유실 방향을 대략 가늠한다. */
function lineDelta(a, b) {
  const norm = (md) =>
    md
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const linesA = norm(a);
  const linesB = norm(b);
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  return {
    onlyInA: linesA.filter((l) => !setB.has(l)).length,
    onlyInB: linesB.filter((l) => !setA.has(l)).length,
  };
}

/** 지정한 엔진으로 한 번 변환해 결과를 저장하고 지표를 돌려준다. */
async function runEngine(hwpPath, name, engine) {
  const prev = process.env[HWP_ENGINE_ENV];
  if (engine === "kordoc") process.env[HWP_ENGINE_ENV] = "kordoc";
  else delete process.env[HWP_ENGINE_ENV];

  try {
    const t0 = performance.now();
    const r = await convert({ inputPath: hwpPath });
    const ms = Math.round(performance.now() - t0);
    await writeFile(join(outDir, `${name}.${engine}.md`), r.markdown);
    if (r.warnings?.length) {
      await writeFile(
        join(outDir, `${name}.${engine}.warnings.json`),
        JSON.stringify(r.warnings, null, 2),
      );
    }
    return {
      markdown: r.markdown,
      ms,
      chars: r.markdown.length,
      tables: countTables(r.markdown),
      tableRows: countTableRows(r.markdown),
      headings: countHeadings(r.markdown),
      images: r.images.length,
      warnings: (r.warnings ?? []).length,
      glyphs: glyphCensus(r.markdown),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (prev === undefined) delete process.env[HWP_ENGINE_ENV];
    else process.env[HWP_ENGINE_ENV] = prev;
  }
}

// ─── 실행 ────────────────────────────────────────────────
const rows = [];
for (const hwpPath of hwpPaths) {
  const name = basename(hwpPath, extname(hwpPath));
  const java = await runEngine(hwpPath, name, "java");
  const kordoc = await runEngine(hwpPath, name, "kordoc");

  const row = { name, java, kordoc };
  if (java.markdown && kordoc.markdown) {
    row.delta = lineDelta(java.markdown, kordoc.markdown);
  }
  // 산출물 md는 이미 파일로 저장했으므로 요약에서는 뺀다.
  delete row.java.markdown;
  delete row.kordoc.markdown;
  rows.push(row);
}

await writeFile(join(outDir, "summary.json"), JSON.stringify(rows, null, 2));

// ─── 요약 출력 ───────────────────────────────────────────
console.log(
  "\n=== HWP5 A/B 요약 (a: Java→HWPX→자체 파서 / b: kordoc 직파싱) ===",
);
for (const r of rows) {
  console.log(`\n📄 ${r.name}`);
  printEngine("Java  ", r.java);
  printEngine("kordoc", r.kordoc);
  if (r.delta) {
    console.log(
      `  [차이] Java에만 있는 줄 ${r.delta.onlyInA}, kordoc에만 있는 줄 ${r.delta.onlyInB}`,
    );
  }
}
console.log(
  `\n산출물: ${outDir}/<이름>.{java,kordoc}.md + summary.json — diff로 비교하세요.`,
);

function printEngine(label, e) {
  if (e.error) {
    console.log(`  [${label}] 실패: ${e.error}`);
    return;
  }
  const glyphs = Object.entries(e.glyphs)
    .map(([g, n]) => `${g}×${n}`)
    .join(" ");
  console.log(
    `  [${label}] ${e.chars}자, 표 ${e.tables}개(행 ${e.tableRows}), 제목 ${e.headings}, 이미지 ${e.images}, 경고 ${e.warnings}, ${e.ms}ms${glyphs ? ` | ${glyphs}` : ""}`,
  );
}
