#!/usr/bin/env node
/**
 * K2 — 스캔본 PDF 표본 생성기 (docs/kordoc-integration.md §5 참조)
 *
 * 텍스트 레이어가 있는 PDF 를 페이지 이미지로 래스터화해 **이미지만 든 PDF** 로
 * 다시 만든다. 실제 문서 레이아웃 그대로의 스캔본 표본을 얻는 것이 목적이다
 * (스캔본을 따로 구하지 않고도 OCR 필요 판정·경고 경로를 실측할 수 있다).
 *
 * ⚠️ 종이를 실제로 스캔한 것이 아니라 깨끗한 렌더 결과이므로, 기울어짐·잡티·
 * 번짐이 없는 **상한치** 표본이다. OCR 정확도의 하한을 보려면 실스캔이 필요하다.
 *
 * 사용법:
 *   node scripts/make-scan-pdf.mjs <원본.pdf> [-o <출력.pdf>] [--pages N]
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** pnpm 저장소에서 패키지 실경로를 찾아 로드한다 (전이 의존성이라 루트에서 안 잡힘) */
function loadFromStore(entry) {
  // `.pnpm/node_modules` 는 pnpm 이 현재 lockfile 에 링크된 정확한 버전을
  // 심링크해 두는 숨김 호이스트 디렉토리다. 스토어(`.pnpm/`)를 직접 스캔해
  // 버전을 고르면 갱신·롤백 잔여 디렉토리(lockfile 이 참조하지 않는 옛/새
  // 버전)를 조용히 집을 수 있어 쓰지 않는다.
  const hoisted = resolve(REPO, "node_modules/.pnpm/node_modules");
  try {
    return require(resolve(hoisted, entry));
  } catch (err) {
    throw new Error(`의존성을 찾을 수 없습니다: ${entry} (pnpm install 필요)`, {
      cause: err,
    });
  }
}

const { PDFiumLibrary } = loadFromStore("@hyzyla/pdfium/dist/index.cjs");
const sharp = loadFromStore("sharp");
const { chromium } = require(
  require.resolve("playwright-core", {
    paths: [resolve(REPO, "packages/core")],
  }),
);

// ─── 인자 ────────────────────────────────────────────────
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("-"));
if (!input) {
  console.error(
    "사용법: node scripts/make-scan-pdf.mjs <원본.pdf> [-o <출력.pdf>] [--pages N]",
  );
  process.exit(1);
}
const outFlag = args.indexOf("-o");
// 지정이 없으면 원본 옆에 둔다. 비공개 문서를 개인 폴더에서 다루면 스캔본도
// 같은 폴더에 남아, 원본만 격리해두면 파생물도 함께 격리된다.
const output =
  outFlag >= 0
    ? resolve(args[outFlag + 1])
    : resolve(dirname(resolve(input)), `${basename(input, ".pdf")}_스캔본.pdf`);
const pageFlag = args.indexOf("--pages");
const maxPages = pageFlag >= 0 ? Number(args[pageFlag + 1]) : 6;

/** 스캔 해상도 배율 — 2 면 A4 기준 약 150dpi */
const SCALE = 2;

// ─── 페이지 래스터화 ─────────────────────────────────────
const library = await PDFiumLibrary.init();
const doc = await library.loadDocument(readFileSync(resolve(input)));

const pngs = [];
for (const page of doc.pages()) {
  if (pngs.length >= maxPages) break;
  const rendered = await page.render({ scale: SCALE, render: "bitmap" });

  // pdfium 은 BGRA 로 준다. sharp 의 raw 입력은 RGBA 이므로 채널을 맞바꾼다.
  const rgba = Buffer.from(rendered.data);
  for (let i = 0; i < rgba.length; i += 4) {
    const b = rgba[i];
    rgba[i] = rgba[i + 2];
    rgba[i + 2] = b;
  }

  const png = await sharp(rgba, {
    raw: { width: rendered.width, height: rendered.height, channels: 4 },
  })
    .grayscale() // 흑백 스캔에 가깝게
    .png({ compressionLevel: 9 })
    .toBuffer();

  pngs.push({ png });
}
doc.destroy();
library.destroy();

// ─── 이미지만 든 PDF 로 재인쇄 ───────────────────────────
const body = pngs
  .map(
    (p) =>
      `<img src="data:image/png;base64,${p.png.toString("base64")}" style="page-break-after:always">`,
  )
  .join("");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(
    `<style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block}</style>${body}`,
    { waitUntil: "load" },
  );
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await writeFile(output, pdf);
  console.log(
    `✓ ${output} (${pngs.length}쪽, ${(pdf.length / 1024 / 1024).toFixed(1)}MB)`,
  );
} finally {
  await browser.close();
}
