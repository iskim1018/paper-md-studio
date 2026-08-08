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

  // (b) kordoc — 기본값과 표 감지 끔(tables:false)을 모두 돌린다.
  //     합성 코퍼스 실측에서 표 감지가 2단 구분선·점선 리더에 과잉 발화해
  //     읽기 순서를 뒤집는 사례가 나왔다. 하이브리드 전략 판단에 둘 다 필요하다.
  const buffer = await readFile(pdfPath).catch(() => null);
  if (buffer) {
    Object.assign(row, await runKordoc(buffer, name, "kordoc", undefined));
    Object.assign(
      row,
      await runKordoc(buffer, name, "kordoc-notables", { tables: false }),
    );
  }

  rows.push(row);
}

/**
 * kordoc 으로 한 번 변환해 결과를 저장하고 지표를 돌려줍니다.
 *
 * pdfjs 가 입력 버퍼의 소유권을 워커로 넘겨 detach 시키므로, 같은 파일을 두 번
 * 파싱하려면 호출마다 사본을 줘야 한다 (안 그러면 두 번째가 EMPTY_INPUT).
 */
async function runKordoc(buffer, name, label, options) {
  const prefix = label === "kordoc" ? "kor" : "korNt";
  try {
    const copy = Uint8Array.prototype.slice.call(buffer);
    const t0 = performance.now();
    const r = options
      ? await kordoc.parse(copy, options)
      : await kordoc.parse(copy);
    const ms = Math.round(performance.now() - t0);

    if (!r.success) {
      return { [`${prefix}Error`]: `${r.code ?? "?"}: ${r.error}` };
    }

    await writeFile(join(outDir, `${name}.${label}.md`), r.markdown);
    if (r.warnings?.length) {
      await writeFile(
        join(outDir, `${name}.${label}.warnings.json`),
        JSON.stringify(r.warnings, null, 2),
      );
    }

    return {
      [`${prefix}Ms`]: ms,
      [`${prefix}Chars`]: r.markdown.length,
      [`${prefix}Tables`]: countTables(r.markdown),
      [`${prefix}TableRows`]: countTableRows(r.markdown),
      [`${prefix}Warnings`]: (r.warnings ?? []).length,
      [`${prefix}NeedsOcr`]: r.qualitySummary?.needsOcr ?? false,
    };
  } catch (err) {
    return {
      [`${prefix}Error`]: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── 요약 출력 ───────────────────────────────────────────
console.log("\n=== PDF A/B 요약 ===");
for (const r of rows) {
  console.log(`\n📄 ${r.name}`);
  if (r.curError) console.log(`  [현행] 실패: ${r.curError}`);
  else
    console.log(
      `  [현행] ${r.curChars}자, 표 ${r.curTables}개(행 ${r.curTableRows}), ${r.curMs}ms`,
    );
  printKordocRow("kordoc", "kor", r);
  printKordocRow("kordoc 표끔", "korNt", r);
}
console.log(
  `\n산출물: ${outDir}/<이름>.{current,kordoc,kordoc-notables}.md — diff로 비교하세요.`,
);

function printKordocRow(label, prefix, r) {
  if (r[`${prefix}Error`]) {
    console.log(`  [${label}] 실패: ${r[`${prefix}Error`]}`);
    return;
  }
  if (r[`${prefix}Chars`] === undefined) return;
  const ocr = r[`${prefix}NeedsOcr`] ? ", ⚠️ needsOcr" : "";
  console.log(
    `  [${label}] ${r[`${prefix}Chars`]}자, 표 ${r[`${prefix}Tables`]}개(행 ${r[`${prefix}TableRows`]}), ${r[`${prefix}Ms`]}ms, 경고 ${r[`${prefix}Warnings`]}${ocr}`,
  );
}
