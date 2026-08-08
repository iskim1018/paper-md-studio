#!/usr/bin/env node
/**
 * K3 — HWP 5.x A/B 비교 스크립트 (docs/kordoc-integration.md §6 참조)
 *
 * 같은 .hwp를 (a) 현행 Java 툴체인(→HWPX→자체 파서), (b) kordoc 직파싱으로
 * 각각 변환해 나란히 저장하고 요약을 출력한다. 사전에 `pnpm build` 필요.
 *
 * 두 경로 모두 core의 convert()를 통과시킨다. 이미지 참조 재작성·경고 배선까지
 * 포함한 통합 결과라야 "Java를 걷어낼 수 있는가"에 답할 수 있기 때문이다.
 *
 * ⚠️ 계측기가 틀리면 판단이 통째로 틀어진다 (2026-08-08 실제 발생: GFM `|…|`
 *    줄만 세는 바람에 kordoc의 HTML <table> 87개를 0으로 집계해 "kordoc이 표를
 *    잃는다"는 잘못된 결론을 냈다). 지표를 늘릴 때는 항상 "같은 것의 다른
 *    표현형이 있는가"를 먼저 묻는다.
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
const { getEncoding } = await import(
  join(REPO, "node_modules/js-tiktoken/dist/index.js")
);

const HWP_ENGINE_ENV = "PAPER_MD_STUDIO_HWP_ENGINE";

// 제품의 1급 목표가 AI 입력 토큰 절감이므로 토큰이 1급 지표다.
// o200k_base = GPT-4o/o200k 계열 인코딩.
const encoder = getEncoding("o200k_base");

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

/**
 * 표를 표현형별로 나눠 센다.
 *
 * 두 엔진이 같은 표를 다른 문법으로 낸다 — 자체 파서는 GFM 파이프 표,
 * kordoc은 HTML <table>(colspan/rowspan 원형 보존). 합계만 보면 한쪽이
 * 0으로 보이므로 반드시 나눠 기록한다.
 */
function tableStats(md) {
  const lines = md.split("\n");
  // GFM: separator 행(|---|---|) 개수 = 표 개수 근사
  const gfmTables = lines.filter((l) => /^\s*\|[\s:|-]+\|\s*$/.test(l)).length;
  const gfmRows = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  const htmlTables = (md.match(/<table[\s>]/gi) ?? []).length;
  const htmlRows = (md.match(/<tr[\s>]/gi) ?? []).length;
  const spanAttrs = (md.match(/\b(?:colspan|rowspan)\s*=/gi) ?? []).length;
  return {
    gfmTables,
    gfmRows,
    htmlTables,
    htmlRows,
    spanAttrs,
    totalTables: gfmTables + htmlTables,
    // GFM 표는 separator 행이 실데이터가 아니므로 빼고 센다.
    totalRows: Math.max(0, gfmRows - gfmTables) + htmlRows,
  };
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
 * 달라 보이는 문제라 수치로 남긴다 (W2에서 통일 예정).
 */
const GLYPHS = ["■", "□", "◻", "☑", "☒", "✓", "✔", "✗", "●", "○", "▪", "➢"];
function glyphCensus(md) {
  const census = {};
  for (const g of GLYPHS) {
    const n = md.split(g).length - 1;
    if (n > 0) census[g] = n;
  }
  // 코드포인트 이스케이프로만 쓴다. 리터럴 PUA 문자를 소스에 넣으면 보이지
  // 않아 편집·복사 과정에서 조용히 사라진다 — 실제로 그렇게 사라져 이 클래스가
  // `[-]`(하이픈 매칭)이 되는 바람에 GFM 구분선 `---`을 PUA로 세고 있었다
  // (2026-08-08, 표본4의 "PUA잔존 1,870"은 전부 하이픈이었다).
  const pua = md.match(/[\u{F000}-\u{F0FF}\u{F0000}-\u{FFFFD}]/gu);
  if (pua) census["PUA잔존"] = pua.length;
  return census;
}

/**
 * 한쪽에만 있는 토큰을 "띄어쓰기 표기차"와 "실질 부재"로 가른다.
 *
 * 단순 집합 차집합은 쓸모가 없다. 자체 파서는 표 셀을 공백 없이 이어붙여
 * 합성어를 만들고 kordoc은 같은 내용을 띄어 쓴다 — 내용은 같은데 토큰만
 * 다르다. 상대 문서의 **공백 제거 전문**에서 부분문자열로 재탐색하면 이
 * 둘이 사람 판독 없이 갈린다. 숫자는 쉼표·끝점을 지우고 비교한다.
 *
 * ⚠️ 알려진 맹점: 두 엔진의 **셀 순서**가 다르면 이 재탐색이 실패한다.
 *    자체 파서가 이웃한 두 셀을 붙여 만든 합성어(`가나다라`+`마바사` → `가나다라마바사`)
 *    가 상대 문서에는 `마바사 … 가나다라` 순으로 흩어져 있으면 부분문자열로
 *    안 잡힌다. 그래서 잔여 토큰이 0이 아니어도 곧바로 유실이 아니며, 성격은
 *    눈으로 확인해야 한다 (2026-08-08 실측: 남은 것은 전부 이 합성어이거나
 *    상대 엔진이 더 살린 산문이었다).
 */
function lossReport(a, b) {
  const strip = (s) => s.replace(/\s+/g, "");
  const strippedA = strip(a);
  const strippedB = strip(b);

  const analyze = (from, strippedOther) => {
    const tokens = new Set(from.match(/[가-힣]{2,}/g) ?? []);
    let spacingOnly = 0;
    const residual = [];
    for (const t of tokens) {
      if (strippedOther.includes(t)) spacingOnly++;
      else residual.push(t);
    }
    // 성격 판단에 쓰도록 잔여 토큰 표본을 남긴다. 문서 본문 조각이므로
    // summary.anon.json 에는 개수만 남기고 이 목록은 제외한다.
    return {
      total: tokens.size,
      spacingOnly,
      residual: residual.length,
      residualSample: residual.slice(0, 10),
    };
  };

  const numbers = (s) =>
    new Set((s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]/g, "")));
  const numA = numbers(a);
  const numB = numbers(b);

  return {
    // 이름으로 방향을 못 박는다 — "Java쪽 N" 같은 라벨은 어느 엔진이 잃은
    // 건지 정반대로 읽힌다.
    missedByKordoc: analyze(a, strippedB), // Java 출력에만 있는 것
    missedByJava: analyze(b, strippedA), // kordoc 출력에만 있는 것
    numbersMissedByKordoc: [...numA].filter((n) => !numB.has(n)).length,
    numbersMissedByJava: [...numB].filter((n) => !numA.has(n)).length,
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
      tokens: encoder.encode(r.markdown).length,
      ...tableStats(r.markdown),
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
for (const [i, hwpPath] of hwpPaths.entries()) {
  const name = basename(hwpPath, extname(hwpPath));
  const java = await runEngine(hwpPath, name, "java");
  const kordoc = await runEngine(hwpPath, name, "kordoc");

  // 콘솔에는 익명 라벨만 쓴다. 비공개 문서의 제목이 터미널 출력·로그·붙여넣기를
  // 타고 저장소 밖으로 나가는 경로를 원천 차단한다 (2026-08-08 실제 발생).
  const row = { name, label: `표본${i + 1}`, java, kordoc };
  if (java.markdown && kordoc.markdown) {
    row.loss = lossReport(java.markdown, kordoc.markdown);
  }
  // 산출물 md는 이미 파일로 저장했으므로 요약에서는 뺀다.
  delete row.java.markdown;
  delete row.kordoc.markdown;
  rows.push(row);
}

// summary.json 은 private/ 안에 있으므로 문서명을 담아도 된다 (대조용).
await writeFile(join(outDir, "summary.json"), JSON.stringify(rows, null, 2));
// 익명 사본 — 수치만 옮길 때 이 파일을 쓴다. 문서 제목뿐 아니라 본문 조각인
// residualSample 도 함께 털어낸다. 하나라도 남으면 익명 사본의 의미가 없다.
const anonymize = ({ name: _omit, loss, ...rest }) => ({
  ...rest,
  ...(loss
    ? {
        loss: {
          ...loss,
          missedByKordoc: { ...loss.missedByKordoc, residualSample: undefined },
          missedByJava: { ...loss.missedByJava, residualSample: undefined },
        },
      }
    : {}),
});
await writeFile(
  join(outDir, "summary.anon.json"),
  JSON.stringify(rows.map(anonymize), null, 2),
);

// ─── 요약 출력 ───────────────────────────────────────────
console.log(
  "\n=== HWP5 A/B 요약 (a: Java→HWPX→자체 파서 / b: kordoc 직파싱) ===",
);
for (const r of rows) {
  console.log(`\n📄 ${r.label}`);
  printEngine("Java  ", r.java);
  printEngine("kordoc", r.kordoc);
  if (r.loss) {
    const { missedByKordoc: mk, missedByJava: mj } = r.loss;
    console.log(
      `  [잔여토큰] kordoc이 못 담은 것 ${mk.residual} / Java가 못 담은 것 ${mj.residual}` +
        ` (띄어쓰기 표기차 ${mk.spacingOnly}·${mj.spacingOnly}는 제외)`,
    );
    console.log(
      `             숫자: kordoc ${r.loss.numbersMissedByKordoc} / Java ${r.loss.numbersMissedByJava}` +
        ` — 잔여는 유실 확정이 아니다(셀 순서 차이). 성격은 summary.json 의 residualSample 확인`,
    );
  }
  if (r.java.tokens && r.kordoc.tokens) {
    const diff = r.kordoc.tokens - r.java.tokens;
    const pct = ((diff / r.java.tokens) * 100).toFixed(1);
    console.log(
      `  [토큰] kordoc ${diff >= 0 ? "+" : ""}${diff} (${pct}%) — 목표: Java 이하`,
    );
  }
}
console.log(
  `\n산출물: ${outDir}/<이름>.{java,kordoc}.md + summary.json (제목 포함) / summary.anon.json (수치만)`,
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
    `  [${label}] ${e.tokens}토큰 (${e.chars}자), ` +
      `표 GFM ${e.gfmTables}/HTML ${e.htmlTables} (행 ${e.totalRows}, span ${e.spanAttrs}), ` +
      `제목 ${e.headings}, 이미지 ${e.images}, 경고 ${e.warnings}, ${e.ms}ms` +
      `${glyphs ? ` | ${glyphs}` : ""}`,
  );
}
