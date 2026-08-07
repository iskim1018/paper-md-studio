#!/usr/bin/env node
/**
 * K2 — PDF A/B 비교 스크립트 (docs/kordoc-integration.md §5 참조)
 *
 * 같은 PDF를 (a) 현행 core 파이프라인, (b) kordoc 으로 각각 변환해
 * 나란히 저장하고 요약을 출력한다. 사전에 `pnpm build` 필요.
 *
 * 사용법:
 *   node scripts/pdf-ab.mjs <pdf파일-또는-디렉토리>... [-o <출력디렉토리>]
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.KORDOC_OFFLINE ??= "1";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { convert } = await import(join(REPO, "packages/core/dist/index.js"));
const kordoc = await import(
  join(REPO, "packages/core/node_modules/kordoc/dist/index.js")
);

// ─── 인자 파싱 ───────────────────────────────────────────
const args = process.argv.slice(2);
const outFlag = args.indexOf("-o");
const outDir =
  outFlag >= 0 ? resolve(args[outFlag + 1]) : resolve("pdf-ab-out");
const inputs = args.filter((a, i) => i !== outFlag && i !== outFlag + 1);

if (inputs.length === 0) {
  console.error(
    "사용법: node scripts/pdf-ab.mjs <pdf파일-또는-디렉토리>... [-o <출력디렉토리>]",
  );
  process.exit(1);
}

const pdfPaths = [];
for (const input of inputs) {
  const s = await stat(input);
  if (s.isDirectory()) {
    for (const f of await readdir(input)) {
      if (extname(f).toLowerCase() === ".pdf") pdfPaths.push(join(input, f));
    }
  } else {
    pdfPaths.push(input);
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

// ─── 실행 ────────────────────────────────────────────────
const rows = [];
for (const pdfPath of pdfPaths) {
  const name = basename(pdfPath, ".pdf");
  const row = { name };

  // (a) 현행 파이프라인
  try {
    const t0 = performance.now();
    const cur = await convert({ inputPath: pdfPath });
    row.curMs = Math.round(performance.now() - t0);
    row.curChars = cur.markdown.length;
    row.curTables = countTables(cur.markdown);
    row.curTableRows = countTableRows(cur.markdown);
    await writeFile(join(outDir, `${name}.current.md`), cur.markdown);
  } catch (err) {
    row.curError = err instanceof Error ? err.message : String(err);
  }

  // (b) kordoc
  try {
    const buffer = await readFile(pdfPath);
    const t0 = performance.now();
    const r = await kordoc.parse(buffer);
    row.korMs = Math.round(performance.now() - t0);
    if (r.success) {
      row.korChars = r.markdown.length;
      row.korTables = countTables(r.markdown);
      row.korTableRows = countTableRows(r.markdown);
      row.korWarnings = (r.warnings ?? []).length;
      row.korNeedsOcr = r.qualitySummary?.needsOcr ?? false;
      await writeFile(join(outDir, `${name}.kordoc.md`), r.markdown);
      if (r.warnings?.length) {
        await writeFile(
          join(outDir, `${name}.kordoc.warnings.json`),
          JSON.stringify(r.warnings, null, 2),
        );
      }
    } else {
      row.korError = `${r.code ?? "?"}: ${r.error}`;
    }
  } catch (err) {
    row.korError = err instanceof Error ? err.message : String(err);
  }

  rows.push(row);
}

// ─── 요약 출력 ───────────────────────────────────────────
console.log("\n=== PDF A/B 요약 ===");
for (const r of rows) {
  console.log(`\n📄 ${r.name}`);
  if (r.curError) console.log(`  [현행] 실패: ${r.curError}`);
  else
    console.log(
      `  [현행]  ${r.curChars}자, 표 ${r.curTables}개(행 ${r.curTableRows}), ${r.curMs}ms`,
    );
  if (r.korError) console.log(`  [kordoc] 실패: ${r.korError}`);
  else
    console.log(
      `  [kordoc] ${r.korChars}자, 표 ${r.korTables}개(행 ${r.korTableRows}), ${r.korMs}ms, 경고 ${r.korWarnings}${r.korNeedsOcr ? ", ⚠️ needsOcr" : ""}`,
    );
}
console.log(
  `\n산출물: ${outDir}/<이름>.{current,kordoc}.md — diff로 비교하세요.`,
);
