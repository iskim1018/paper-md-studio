#!/usr/bin/env node
/**
 * DOCX 표 변환 자동 대조 하니스.
 *
 * 기준값: mammoth 중간 HTML(원본 표 구조를 보존) → 이 스크립트의 독립 구현으로
 * 병합 전개 grid를 계산한다. 대상값: core convert()의 최종 GFM 표.
 * core(html-tables-to-gfm.ts)와 다른 구현으로 grid를 만들어야 core 버그도 잡힌다.
 *
 * 사람이 문서를 눈으로 보지 않아도 표 변환 품질을 판정할 수 있다:
 *   - 표 개수, 표별 행/열 수 일치
 *   - 셀 텍스트 보존 (링크 URL부·이미지 문법·md 강조는 정규화 후 비교)
 *   - 병합 자리 화살표(←/↑) 위치 정확성
 *   - GFM 1행 1줄·행 폭 균일성 (ragged 검출)
 *
 * stdout에는 통계와 마스킹된 불일치 요약만 낸다 (비공개 문서 본문 미출력).
 * 변환 결과 md 저장은 -o <디렉토리> 지정 시에만 한다.
 *
 * 사용법:
 *   node scripts/docx-verify.mjs <docx파일>... [-o <출력디렉토리>]
 *   DETAIL=1 …  # 불일치 셀의 마스킹된 문자 단위 상세를 stderr로
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(REPO, "packages/core/package.json"));
const mammoth = require("mammoth");
const { parseHTML } = require("linkedom");
const { convert } = await import(join(REPO, "packages/core/dist/index.js"));

const MAX_PROBLEMS = 8;
const MASK = (s) => s.replace(/[가-힣A-Za-z0-9]/g, "x");

/** HTML 표 → 기준 grid. 셀: {kind:'text'|'left'|'up', ...} */
function expectedGrid(table) {
  const rows = [...table.children].flatMap((c) => {
    if (c.tagName === "TR") return [c];
    if (["THEAD", "TBODY", "TFOOT"].includes(c.tagName))
      return [...c.children].filter((r) => r.tagName === "TR");
    return [];
  });
  const grid = [];
  const reserved = new Map(); // col → 남은 rowspan 행 수
  for (const tr of rows) {
    const cells = [...tr.children].filter((c) =>
      ["TD", "TH"].includes(c.tagName),
    );
    const out = [];
    let col = 0;
    let i = 0;
    const drain = () => {
      while ((reserved.get(col) ?? 0) > 0) {
        out[col] = { kind: "up" };
        const left = reserved.get(col) - 1;
        if (left <= 0) reserved.delete(col);
        else reserved.set(col, left);
        col += 1;
      }
    };
    while (i < cells.length || (reserved.get(col) ?? 0) > 0) {
      drain();
      const cell = cells[i];
      if (!cell) break;
      i += 1;
      const cs = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
      const rs = Math.max(1, Number(cell.getAttribute("rowspan")) || 1);
      const nested = cell.querySelector("table");
      const clone = cell.cloneNode(true);
      for (const t of clone.querySelectorAll("table")) t.remove();
      const start = col;
      out[col] = {
        kind: "text",
        text: clone.textContent ?? "",
        hasNested: Boolean(nested),
        nestedTexts: nested
          ? [...cell.querySelectorAll("table td, table th")].map(
              (c) => c.textContent ?? "",
            )
          : [],
        hasImg: Boolean(clone.querySelector("img")),
      };
      col += 1;
      for (let k = 1; k < cs; k += 1) {
        out[col] = { kind: "left" };
        col += 1;
      }
      if (rs > 1) for (let c = start; c < col; c += 1) reserved.set(c, rs - 1);
    }
    grid.push(out);
  }
  const width = Math.max(0, ...grid.map((r) => r.length));
  for (const r of grid)
    for (let c = 0; c < width; c += 1)
      r[c] ??= {
        kind: "text",
        text: "",
        hasNested: false,
        nestedTexts: [],
        hasImg: false,
      };
  return grid;
}

/** GFM 표 파싱: 연속된 | 줄 블록 → separator 제외한 셀 grid */
function parseGfmTables(md) {
  const blocks = [];
  let cur = [];
  for (const line of md.split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) cur.push(line.trim());
    else if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks.map((lines) =>
    lines
      .filter((l) => !/^\|(\s*:?-+:?\s*\|)+$/.test(l))
      .map((l) =>
        l
          .split(/(?<!\\)\|/)
          .slice(1, -1)
          .map((c) => c.trim()),
      ),
  );
}

/**
 * 비교용 정규화. 원본 textContent에 없는 "추가 정보"는 지우고 비교한다:
 *   - 이미지 문법 (경로에 공백·괄호가 있으면 turndown이 `(<경로>)` 꺾쇠형을 씀)
 *   - 링크 URL부 (각주 참조 `[\[1\]](#footnote-N)`·하이퍼링크 — URL은 덧붙는 정보)
 *   - autolink(<https://…>), md 강조, escape, 공백
 */
function norm(s) {
  return s
    .replace(/!\[[^\]]*\]\((?:<[^>]*>|(?:[^)\\]|\\.)*)\)/g, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/\]\((?:<[^>]*>|[^)]*)\)/g, "]")
    .replace(/<[a-z][a-z+.-]*:[^\s>]*>/gi, "")
    .replace(/[*_`]/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/[[\]()]/g, "")
    .replace(/\s+/g, "");
}

function compareCell(e, a, where, report, tstat) {
  if (e.kind === "left" || e.kind === "up") {
    const want = e.kind === "left" ? "←" : "↑";
    if (a === want) tstat.arrowOk += 1;
    else {
      tstat.arrowDiff += 1;
      if (report.problems.length < MAX_PROBLEMS)
        report.problems.push(
          `${where}: 병합자리 기대 ${want}, 실제 "${MASK(a).slice(0, 20)}"`,
        );
    }
    return;
  }
  let ok;
  let label;
  if (e.hasNested) {
    ok =
      a.includes("(표") &&
      e.nestedTexts.every((nt) => norm(a).includes(norm(nt)));
    label = "중첩표 셀 내용 불일치";
  } else {
    const okText = norm(e.text) === "" || norm(a).includes(norm(e.text));
    const okImg = !e.hasImg || a.includes("![");
    ok = okText && okImg;
    label = okImg
      ? `텍스트 불일치 기대"${MASK(e.text).slice(0, 15)}" 실제"${MASK(a).slice(0, 15)}"`
      : "이미지 누락";
  }
  if (ok) {
    tstat.cellOk += 1;
    return;
  }
  tstat.cellDiff += 1;
  if (report.problems.length < MAX_PROBLEMS)
    report.problems.push(`${where}: ${label}`);
  if (process.env.DETAIL && !e.hasNested) {
    const ne = MASK(norm(e.text));
    const na = MASK(norm(a));
    let d = 0;
    while (d < Math.min(ne.length, na.length) && ne[d] === na[d]) d += 1;
    process.stderr.write(
      `[detail] ${where}\n  기대(norm): ${ne.slice(0, 80)}\n  실제(norm): ${na.slice(0, 80)}\n` +
        `  첫 분기 idx=${d} 기대[…${ne.slice(Math.max(0, d - 5), d + 10)}…] 실제[…${na.slice(Math.max(0, d - 5), d + 10)}…]\n`,
    );
  }
}

function compareTable(exp, act, t, report) {
  const expW = exp[0]?.length ?? 0;
  const actW = act[0]?.length ?? 0;
  const tstat = {
    idx: t + 1,
    rows: `${exp.length}→${act.length}${exp.length === act.length ? "" : " ❌"}`,
    cols: `${expW}→${actW}${expW === actW ? "" : " ❌"}`,
    cellOk: 0,
    cellDiff: 0,
    arrowOk: 0,
    arrowDiff: 0,
    raggedRows: 0,
  };
  for (let r = 0; r < Math.min(exp.length, act.length); r += 1) {
    if (act[r].length !== actW) tstat.raggedRows += 1;
    for (let c = 0; c < Math.min(exp[r].length, act[r].length); c += 1) {
      compareCell(
        exp[r][c],
        act[r][c] ?? "",
        `표${t + 1} r${r + 1}c${c + 1}`,
        report,
        tstat,
      );
    }
  }
  return tstat;
}

async function verify(inputPath, outDir) {
  const name = basename(inputPath);
  const buffer = await readFile(inputPath);
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const { document } = parseHTML(`<body>${html}</body>`);
  const allTables = [...document.querySelectorAll("table")];
  const topTables = allTables.filter(
    (t) => !t.parentElement?.closest?.("table"),
  );
  const expected = topTables.map(expectedGrid);

  const result = await convert({ inputPath, saveImages: false });
  const md = result.markdown;
  if (outDir) {
    const slug = name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w가-힣-]+/g, "_")
      .slice(0, 40);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${slug}.md`), md, "utf-8");
  }
  const actual = parseGfmTables(md);

  const report = {
    file: name,
    htmlTopTables: topTables.length,
    htmlNestedTables: allTables.length - topTables.length,
    gfmTables: actual.length,
    mdHtmlTableResidue: (md.match(/<table/gi) ?? []).length,
    images: result.images.length,
    warnings: result.warnings ?? [],
    tables: [],
    problems: [],
  };
  for (let t = 0; t < Math.min(expected.length, actual.length); t += 1) {
    report.tables.push(compareTable(expected[t], actual[t], t, report));
  }
  report.totals = report.tables.reduce(
    (s, t) => ({
      cellOk: s.cellOk + t.cellOk,
      cellDiff: s.cellDiff + t.cellDiff,
      arrowOk: s.arrowOk + t.arrowOk,
      arrowDiff: s.arrowDiff + t.arrowDiff,
      ragged: s.ragged + t.raggedRows,
      rowsBad: s.rowsBad + (t.rows.includes("❌") ? 1 : 0),
      colsBad: s.colsBad + (t.cols.includes("❌") ? 1 : 0),
    }),
    {
      cellOk: 0,
      cellDiff: 0,
      arrowOk: 0,
      arrowDiff: 0,
      ragged: 0,
      rowsBad: 0,
      colsBad: 0,
    },
  );
  return report;
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("-o");
const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
const files =
  outIdx >= 0 ? [...args.slice(0, outIdx), ...args.slice(outIdx + 2)] : args;

if (files.length === 0) {
  process.stderr.write(
    "사용법: node scripts/docx-verify.mjs <docx파일>... [-o <출력디렉토리>]\n",
  );
  process.exit(1);
}

let failed = false;
for (const f of files) {
  const r = await verify(f, outDir);
  process.stdout.write(`${JSON.stringify(r, null, 1)}\n`);
  const ok =
    r.htmlTopTables === r.gfmTables &&
    r.mdHtmlTableResidue === 0 &&
    r.totals.cellDiff === 0 &&
    r.totals.arrowDiff === 0 &&
    r.totals.ragged === 0 &&
    r.totals.rowsBad === 0 &&
    r.totals.colsBad === 0;
  process.stdout.write(ok ? "→ PASS\n" : "→ FAIL\n");
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
