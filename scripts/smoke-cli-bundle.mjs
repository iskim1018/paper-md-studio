#!/usr/bin/env node
/**
 * 배포 리소스에 들어간 CLI 번들을 **출하 그대로** 실행해 보는 스모크 검사.
 *
 * 빌드가 통과해도 번들은 실행할 때에만 깨지는 지점이 있다.
 *   - 미니 node_modules(@rhwp/core WASM, pdf-inspector NAPI)가 빠지거나 어긋남
 *   - 번들에 인라인돼야 할 의존성(cfb 등)이 동적 require 로 남음
 *   - 번들 Node 는 CI 의 Node 와 버전이 달라, 그 버전에서만 나는 오류
 * 그래서 런타임에 만든 작은 문서를 번들 Node 로 실제 변환해 본다.
 *
 * 저장소 안에서 그대로 돌리면 packages/app/node_modules/@rhwp/core 처럼 상위
 * 폴더의 node_modules 가 빠진 파일을 가려 준다 — .app 안에는 그런 폴더가 없다.
 * 그래서 resources/cli 를 저장소 바깥 임시 폴더로 복사해 그 사본을 실행하고,
 * 작업 폴더(cwd)도 저장소 바깥으로 둔다. Node 바이너리는 위치가 모듈 해석에
 * 영향을 주지 않으므로 리소스에 있는 것을 그대로 쓴다.
 *
 * 검사 문서 (커밋된 바이너리 픽스처 없이 실행 시점에 만든다):
 *   - .hwp  rhwp 편집 API 로 만든 HWP 5.0 — 번들의 rhwp WASM 로드·변환
 *   - .xls  최소 BIFF8 — 번들에 인라인된 cfb
 *   - .pdf  손으로 쓴 텍스트 PDF — 번들의 pdf-inspector 네이티브 바이너리
 *
 * 사전 조건: pnpm build:node → pnpm build:cli-bundle → pnpm build:app-resources
 * 사용법: node scripts/smoke-cli-bundle.mjs
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDir = join(
  repoRoot,
  "packages",
  "app",
  "src-tauri",
  "resources",
);
const bundledNode =
  process.platform === "win32"
    ? join(resourcesDir, "node", "node.exe")
    : join(resourcesDir, "node", "bin", "node");
const bundledCliDir = join(resourcesDir, "cli");

/** 픽스처 생성용 의존성(@rhwp/core, cfb)은 core 기준으로 해석한다 */
const coreRequire = createRequire(
  join(repoRoot, "packages", "core", "package.json"),
);

const CLI_TIMEOUT_MS = 120_000;

// ── 픽스처: HWP 5.0 ────────────────────────────────────────────────

const HWP_TEXT = "스모크 검사 문장 — 한글 HWP 5.0";

/** rhwp 편집 API 로 본문 한 문단짜리 HWP 5.0 을 만든다 */
async function makeHwp() {
  const glue = coreRequire.resolve("@rhwp/core");
  const wasm = readFileSync(coreRequire.resolve("@rhwp/core/rhwp_bg.wasm"));
  const rhwp = await import(pathToFileURL(glue).href);
  await rhwp.default({ module_or_path: wasm });
  const doc = rhwp.HwpDocument.createEmpty();
  try {
    doc.createBlankDocument();
    doc.insertText(0, 0, 0, HWP_TEXT);
    return doc.exportHwp();
  } finally {
    doc.free();
  }
}

// ── 픽스처: XLS (BIFF8) ────────────────────────────────────────────

const XLS_TEXT = "스모크 시트 셀";
const XLS_NUMBER = 4217;

function biffRecord(id, payload) {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(payload.length, 2);
  return Buffer.concat([head, payload]);
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value, 0);
  return b;
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

function f64(value) {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value, 0);
  return b;
}

/** BOF — dt 0x0005 전역, 0x0010 시트 */
function bof(dt) {
  return biffRecord(
    0x0809,
    Buffer.concat([u16(0x0600), u16(dt), u16(0x0dbb), u16(0x07cc), u32(0), u32(0)]),
  );
}

/**
 * 시트 하나, 셀 둘(문자열·숫자)짜리 최소 BIFF8. 레코드 배치는
 * packages/core/tests/helpers/biff-writer.ts 와 같다(그쪽은 독립 구현으로
 * 진짜 BIFF8 임을 검증했다).
 */
function makeXls() {
  const CELL_XF = 15;
  const EOF = biffRecord(0x000a, Buffer.alloc(0));
  const sheetName = Buffer.concat([
    Buffer.from([5, 0x00]),
    Buffer.from("Smoke", "latin1"),
  ]);
  const text = Buffer.from(XLS_TEXT, "utf16le");

  const sheet = Buffer.concat([
    bof(0x0010),
    // LABELSST (행 0, 열 0, SST 0번)
    biffRecord(0x00fd, Buffer.concat([u16(0), u16(0), u16(CELL_XF), u32(0)])),
    // NUMBER (행 0, 열 1)
    biffRecord(
      0x0203,
      Buffer.concat([u16(0), u16(1), u16(CELL_XF), f64(XLS_NUMBER)]),
    ),
    EOF,
  ]);

  const xfs = Array.from({ length: CELL_XF + 1 }, () =>
    biffRecord(0x00e0, Buffer.alloc(20)),
  );
  const globals = [
    bof(0x0005),
    biffRecord(0x0022, u16(0)), // DATEMODE 1900
    ...xfs,
    // SST: 문자열 1개 (UTF-16LE 플래그)
    biffRecord(
      0x00fc,
      Buffer.concat([u32(1), u32(1), u16(XLS_TEXT.length), Buffer.from([0x01]), text]),
    ),
  ];
  // BOUNDSHEET 는 시트 스트림 위치를 담으므로 전역 크기를 먼저 확정한다
  const boundsheetSize = 4 + 4 + 2 + sheetName.length;
  const globalsSize =
    globals.reduce((sum, b) => sum + b.length, 0) + boundsheetSize + EOF.length;
  const boundsheet = biffRecord(
    0x0085,
    Buffer.concat([u32(globalsSize), Buffer.from([0x00, 0x00]), sheetName]),
  );
  const workbook = Buffer.concat([...globals, boundsheet, EOF, sheet]);

  const CFB = coreRequire("cfb");
  const container = CFB.utils.cfb_new({ root: "R" });
  CFB.utils.cfb_add(container, "/Workbook", workbook);
  return CFB.write(container, { type: "buffer" });
}

// ── 픽스처: PDF ────────────────────────────────────────────────────

const PDF_TEXT = "Paper MD Studio bundled CLI smoke";

/** Helvetica 텍스트 한 줄짜리 PDF (xref 오프셋을 계산해 쓴다) */
function makePdf() {
  const content = `BT /F1 18 Tf 72 720 Td (${PDF_TEXT}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ── 실행·검증 ──────────────────────────────────────────────────────

function assertPrerequisites() {
  const missing = [bundledNode, join(bundledCliDir, "index.js")].filter(
    (path) => !existsSync(path),
  );
  if (missing.length > 0) {
    throw new Error(
      `배포 리소스가 없습니다: ${missing.join(", ")}\n` +
        "힌트: pnpm build:node → pnpm build:cli-bundle → pnpm build:app-resources",
    );
  }
}

/** 마지막 비어 있지 않은 stdout 줄을 CLI 의 --json 결과로 읽는다 */
function parseJsonOutput(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error("stdout 이 비어 있습니다");
  }
  return JSON.parse(last);
}

function runCase(testCase, cliPath, workDir, outDir) {
  const result = spawnSync(
    bundledNode,
    [cliPath, testCase.input, "--json", "-o", outDir],
    {
      cwd: workDir,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      // 상위 환경이 모듈 해석·실행 옵션을 바꾸지 못하게 한다
      env: {
        ...process.env,
        NODE_PATH: "",
        NODE_OPTIONS: "",
        ...(testCase.env ?? {}),
      },
    },
  );
  const fail = (reason) => {
    throw new Error(
      `[${testCase.name}] ${reason}\n` +
        `  종료 코드: ${result.status} ${result.signal ?? ""}\n` +
        `  stdout: ${(result.stdout ?? "").slice(-2000)}\n` +
        `  stderr: ${(result.stderr ?? "").slice(-2000)}`,
    );
  };

  if (result.error) fail(`실행 실패: ${result.error.message}`);
  if (result.status !== 0) fail("CLI 가 0 이 아닌 코드로 끝났습니다");
  if (/오류|Error/.test(result.stderr ?? "")) fail("stderr 에 오류가 있습니다");

  let json;
  try {
    json = parseJsonOutput(result.stdout ?? "");
  } catch (err) {
    fail(`--json 출력을 읽지 못했습니다: ${err.message}`);
  }
  if (json.format !== testCase.format) {
    fail(`포맷이 다릅니다: ${json.format} (기대: ${testCase.format})`);
  }
  if (typeof json.markdown !== "string" || json.markdown.trim() === "") {
    fail("markdown 이 비어 있습니다");
  }
  for (const expected of testCase.expect) {
    if (!json.markdown.includes(expected)) {
      fail(`markdown 에 "${expected}" 가 없습니다:\n${json.markdown}`);
    }
  }
  // 경고는 폴백(예: pdf-inspector 로드 실패 → pdf2md)을 뜻할 수 있다
  if (json.warnings?.length) {
    fail(`예상치 못한 경고: ${json.warnings.join(" / ")}`);
  }
  const mdPath = json.outputPath;
  if (!existsSync(mdPath) || readFileSync(mdPath, "utf8") !== json.markdown) {
    fail(`출력 파일이 없거나 --json 결과와 다릅니다: ${mdPath}`);
  }
  console.log(
    `✓ ${testCase.name}: ${json.markdown.length}자, ${Math.round(json.elapsed)}ms`,
  );
}

async function main() {
  assertPrerequisites();

  const nodeVersion = spawnSync(bundledNode, ["--version"], {
    encoding: "utf8",
  }).stdout?.trim();
  console.log(`번들 Node: ${nodeVersion} (${bundledNode})`);

  const root = mkdtempSync(join(tmpdir(), "paper-md-smoke-"));
  try {
    // 리소스 레이아웃 그대로 저장소 바깥에 둔다 (cli/index.js + node_modules)
    const isolatedCliDir = join(root, "resources", "cli");
    cpSync(bundledCliDir, isolatedCliDir, { recursive: true });
    const cliPath = join(isolatedCliDir, "index.js");

    const inputDir = join(root, "input");
    const workDir = join(root, "work");
    const outDir = join(root, "out");
    for (const dir of [inputDir, workDir]) mkdirSync(dir, { recursive: true });

    const cases = [
      {
        name: "hwp (rhwp WASM)",
        file: "smoke.hwp",
        bytes: await makeHwp(),
        format: "hwp",
        expect: [HWP_TEXT],
      },
      {
        name: "xls (인라인 cfb)",
        file: "smoke.xls",
        bytes: makeXls(),
        format: "xls",
        expect: [XLS_TEXT, String(XLS_NUMBER)],
      },
      {
        name: "pdf (pdf-inspector 네이티브)",
        file: "smoke.pdf",
        bytes: makePdf(),
        format: "pdf",
        expect: [PDF_TEXT],
      },
      {
        // pdf-inspector 로드 실패 시의 대체 엔진(pdf2md + pdfjs 6). pdfjs 6 은
        // Node 22.13+ 를 요구한다 — 번들 Node 가 뒤처지면 결과 없이 멈췄다(2026-10-03)
        name: "pdf (대체 엔진 pdf2md·pdfjs)",
        file: "smoke-legacy.pdf",
        bytes: makePdf(),
        format: "pdf",
        expect: [PDF_TEXT],
        env: { PAPER_MD_STUDIO_PDF_ENGINE: "legacy" },
      },
    ];

    for (const testCase of cases) {
      const input = join(inputDir, testCase.file);
      writeFileSync(input, testCase.bytes);
      runCase({ ...testCase, input }, cliPath, workDir, outDir);
    }
    console.log("\n번들 CLI 스모크 검사 통과");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
