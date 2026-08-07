#!/usr/bin/env node
/**
 * K2 — 합성 PDF 코퍼스 생성기 (docs/kordoc-integration.md §5 참조)
 *
 * 실무 PDF를 구하기 어려운 병리들을 의도적으로 재현한 PDF를 만든다.
 * headless chromium 으로 HTML 을 인쇄하므로 실제 CJK 폰트가 임베드된
 * PDF 가 나온다 (손으로 쓴 PDF 와 달리 실제 파서 경로를 그대로 탄다).
 *
 * ⚠️ 한계: 한컴이 만든 실파일의 병리(깨진 ToUnicode/CMap, DRM, 조판 캐시)는
 * 재현되지 않는다. 여기 코퍼스는 "표 구조 복원"과 "우리가 이미 고친 회귀의
 * 재발 감시"에 쓰는 용도이고, 최종 판정은 실무 문서로 해야 한다.
 *
 * 사용법:
 *   node scripts/make-pdf-corpus.mjs [-o <출력디렉토리>]   # 기본: ./pdf-corpus
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// playwright-core 는 core 패키지의 optionalDependency(CJS) 라 루트에서
// 바로 import 되지 않는다. core 기준으로 해석해 require 로 로드한다.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright-core", {
    paths: [resolve(REPO, "packages/core")],
  }),
);

const args = process.argv.slice(2);
const outFlag = args.indexOf("-o");
const outDir =
  outFlag >= 0 ? resolve(args[outFlag + 1]) : resolve("pdf-corpus");

const FONT = `"Apple SD Gothic Neo", AppleGothic, sans-serif`;
const BASE_CSS = `
  @page { size: A4; margin: 20mm 15mm; }
  body { font-family: ${FONT}; font-size: 11pt; line-height: 1.6; color: #000; }
  h1 { font-size: 16pt; text-align: center; margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { padding: 6px 8px; font-size: 10pt; }
`;

// ─── 케이스 정의 ─────────────────────────────────────────

/** 1. 괘선 있는 병합 표 — 정부 양식에 흔한 colspan/rowspan 격자 */
const borderedTable = `
<style>${BASE_CSS}
  td, th { border: 1px solid #000; }
  th { background: #e8e8e8; font-weight: bold; }
</style>
<h1>사업 추진 계획서</h1>
<p>다음과 같이 사업 추진 계획을 제출합니다.</p>
<table>
  <tr><th>구분</th><th>사업명</th><th>예산(천원)</th><th>담당부서</th></tr>
  <tr><td rowspan="2">1분기</td><td>노후 상수관 교체</td><td>1,250,000</td><td>수도과</td></tr>
  <tr><td>도로 포장 보수</td><td>870,000</td><td>건설과</td></tr>
  <tr><td rowspan="2">2분기</td><td>공원 정비</td><td>430,000</td><td>녹지과</td></tr>
  <tr><td>보안등 설치</td><td>215,000</td><td>안전과</td></tr>
  <tr><td colspan="2">합계</td><td>2,765,000</td><td>-</td></tr>
</table>
<p>※ 예산은 제21조 및 제3항의 기준에 따라 산정하였으며, 2026년 1월 15일
기준 확정 금액입니다.</p>
<table>
  <tr><th>검토 항목</th><th>결과</th></tr>
  <tr><td>사전 타당성 조사</td><td>☑ 완료</td></tr>
  <tr><td>주민 의견 수렴</td><td>□ 미실시</td></tr>
  <tr><td>환경 영향 평가</td><td>① 해당없음</td></tr>
</table>
`;

/** 2. 무괘선(개방형) 표 — 좌우 테두리 생략, 수평 괘선만 전폭 */
const openTable = `
<style>${BASE_CSS}
  table { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; }
  td, th { border-bottom: 0.5px solid #999; border-left: none; border-right: none; }
  th { font-weight: bold; }
</style>
<h1>채용 공고</h1>
<p>우리 기관은 아래와 같이 직원을 공개 채용합니다.</p>
<table>
  <tr><th>채용분야</th><th>담당업무</th><th>인원</th><th>우대조건</th></tr>
  <tr><td>일반행정</td><td>예산 편성 및 집행 관리</td><td>2명</td><td>관련 자격증 소지자</td></tr>
  <tr><td>토목직</td><td>도로·상하수도 시설 관리</td><td>1명</td><td>실무경력 3년 이상</td></tr>
  <tr><td>전산직</td><td>정보시스템 운영·유지보수</td><td>1명</td><td>정보처리기사</td></tr>
</table>
<p>접수 기간: 2026. 3. 2. ~ 2026. 3. 16. 18:00까지</p>
<p>문의처는 아래와 같습니다.</p>
<table>
  <tr><td>인사팀</td><td>02-1234-5678</td><td>hr@example.go.kr</td></tr>
  <tr><td>총무팀</td><td>02-1234-5679</td><td>ga@example.go.kr</td></tr>
</table>
`;

/** 3. 2단 조판 — 좌우 단이 행 단위로 섞이는지 검증 (시험지·속기록류) */
const twoColumn = `
<style>${BASE_CSS}
  .cols { column-count: 2; column-gap: 12mm; column-rule: 0.5px solid #ccc; }
  .q { break-inside: avoid; margin-bottom: 14px; }
  .head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 12px; }
</style>
<div class="head"><strong>2026학년도 모의평가 문제지 — 사회탐구영역</strong></div>
<div class="cols">
  <div class="q"><b>1.</b> 다음 중 지방자치단체의 사무에 해당하지 않는 것은?
    <br>① 상수도 공급 ② 지방세 부과 ③ 외교 사절 파견 ④ 도시계획 수립</div>
  <div class="q"><b>2.</b> 행정절차법상 처분의 사전통지가 필요한 경우로 옳은 것은?
    <br>① 수익적 처분 ② 침익적 처분 ③ 단순 통지 ④ 내부 지침</div>
  <div class="q"><b>3.</b> 예산의 원칙 중 회계연도 독립의 원칙에 대한 설명으로 옳은 것은?
    <br>① 매 회계연도의 경비는 그 연도의 세입으로 충당한다.
    <br>② 모든 수입은 국고에 편입한다.</div>
  <div class="q"><b>4.</b> 다음 자료를 보고 물음에 답하시오. 갑 지역의 인구는 지난 10년간
    꾸준히 감소하였으며, 이에 따라 학령인구도 함께 줄어들었다.</div>
  <div class="q"><b>5.</b> 정보공개청구 제도의 취지로 가장 적절한 것은?
    <br>① 행정의 투명성 확보 ② 예산 절감 ③ 조직 개편 ④ 인사 관리</div>
  <div class="q"><b>6.</b> 「지방재정법」 제21조에 따른 재정 운용의 기본 원칙은?
    <br>① 건전성 ② 수익성 ③ 폐쇄성 ④ 임의성</div>
</div>
`;

/** 4. 겹쳐 그린 굵은 글씨 — 한컴이 굵게를 표현하는 방식 재현 (글자 중복 회귀) */
function overdraw(text, times, stepPt) {
  const layers = Array.from(
    { length: times },
    (_, i) =>
      `<span style="position:absolute;left:${(i * stepPt).toFixed(2)}pt;top:0">${text}</span>`,
  ).join("");
  return `<span style="position:relative;display:inline-block">${layers}<span style="visibility:hidden">${text}</span></span>`;
}

const overdrawn = `
<style>${BASE_CSS}
  .title { font-size: 20pt; text-align: center; margin: 30px 0; }
</style>
<div class="title">${overdraw("제안요청서", 23, 0.1)}</div>
<p style="text-align:center">${overdraw("정보시스템 구축 사업", 12, 0.12)}</p>
<p>본 제안요청서는 제21조 제3항에 근거하여 작성되었습니다. 총 사업비는
1,250,000천원이며 사업 기간은 2026년 3월 2일부터 12개월입니다.</p>
<p>${overdraw("1. 사업 개요", 8, 0.15)}</p>
<p>발주기관은 제7조에 따라 제안서를 평가하며, 평가 결과는 제15조에 따라
통보합니다. 이의신청은 통보일부터 7일 이내에 제출하여야 합니다.</p>
`;

/** 5. 목차 + 점선 리더 — 목차 오인식·리더 처리 검증 */
const tocLeader = `
<style>${BASE_CSS}
  .toc-item { display: flex; align-items: baseline; margin: 8px 0; }
  .toc-title { white-space: nowrap; }
  .dots { flex: 1; border-bottom: 1.5px dotted #333; margin: 0 6px; transform: translateY(-3px); }
  .pg { white-space: nowrap; }
</style>
<h1>목       차</h1>
<div class="toc-item"><span class="toc-title">Ⅰ. 사업 개요</span><span class="dots"></span><span class="pg">1</span></div>
<div class="toc-item"><span class="toc-title">Ⅱ. 추진 배경 및 필요성</span><span class="dots"></span><span class="pg">3</span></div>
<div class="toc-item"><span class="toc-title">&nbsp;&nbsp;1. 국내외 동향</span><span class="dots"></span><span class="pg">3</span></div>
<div class="toc-item"><span class="toc-title">&nbsp;&nbsp;2. 문제점 분석</span><span class="dots"></span><span class="pg">5</span></div>
<div class="toc-item"><span class="toc-title">Ⅲ. 세부 추진 계획</span><span class="dots"></span><span class="pg">8</span></div>
<div class="toc-item"><span class="toc-title">Ⅳ. 소요 예산</span><span class="dots"></span><span class="pg">12</span></div>
<div class="toc-item"><span class="toc-title">붙임 1. 관련 근거 법령</span><span class="dots"></span><span class="pg">15</span></div>
<div style="page-break-before: always"></div>
<h1>Ⅰ. 사업 개요</h1>
<p>본 사업은 「지방재정법」 제21조 및 같은 법 시행령 제3조에 따라
2026년부터 3개년에 걸쳐 추진한다. 총 사업비는 2,765,000천원이다.</p>
<p>추진 일정은 다음과 같다. 1단계는 2026. 3. 2.부터 2026. 8. 31.까지,
2단계는 2026. 9. 1.부터 2027. 2. 28.까지 진행한다.</p>
`;

const CASES = [
  { name: "01-표-괘선", html: borderedTable },
  { name: "02-표-무괘선", html: openTable },
  { name: "03-2단조판", html: twoColumn },
  { name: "04-겹쳐그린굵은글씨", html: overdrawn },
  { name: "05-목차-점선리더", html: tocLeader },
];

// ─── 실행 ────────────────────────────────────────────────

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    // 번들 chromium 이 없으면 시스템 Chrome 으로 폴백
    return await chromium.launch({ headless: true, channel: "chrome" });
  }
}

await mkdir(outDir, { recursive: true });
const browser = await launchBrowser();

try {
  const page = await browser.newPage();

  for (const c of CASES) {
    await page.setContent(c.html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await writeFile(resolve(outDir, `${c.name}.pdf`), pdf);
    console.log(`✓ ${c.name}.pdf (${(pdf.length / 1024).toFixed(0)}KB)`);
  }

  // 6. 스캔본 — 텍스트층 없이 이미지만 (needsOcr 신호 검증용).
  //    표를 렌더한 화면을 PNG 로 찍어 이미지 하나만 든 PDF 로 다시 인쇄한다.
  await page.setViewportSize({ width: 1240, height: 1754 }); // A4 150dpi
  await page.setContent(borderedTable, { waitUntil: "load" });
  const shot = await page.screenshot({ fullPage: true });
  const dataUri = `data:image/png;base64,${shot.toString("base64")}`;
  await page.setContent(
    `<style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block}</style><img src="${dataUri}">`,
    { waitUntil: "load" },
  );
  const scanPdf = await page.pdf({ format: "A4", printBackground: true });
  await writeFile(resolve(outDir, "06-스캔이미지.pdf"), scanPdf);
  console.log(`✓ 06-스캔이미지.pdf (${(scanPdf.length / 1024).toFixed(0)}KB)`);
} finally {
  await browser.close();
}

console.log(`\n생성 완료: ${outDir}`);
console.log(`다음: node scripts/pdf-ab.mjs ${outDir} -o ./pdf-ab-out`);
