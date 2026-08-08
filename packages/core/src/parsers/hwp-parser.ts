import { spawn } from "node:child_process";
import { access, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeToNFC } from "../normalize.js";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { HwpxParser } from "./hwpx-parser.js";
import { detectBinaryFormat, KordocParser } from "./kordoc-adapter.js";

const JAR_FILE_NAME = "hwp-to-hwpx.jar";
const JAR_ENV_OVERRIDE = "PAPER_MD_STUDIO_HWP_JAR";
const JAVA_ENV = "JAVA_HOME";

/** HWP 5.x 처리 엔진 선택 (K3 실험용) — docs/kordoc-integration.md §6 */
const HWP_ENGINE_ENV = "PAPER_MD_STUDIO_HWP_ENGINE";

export type Hwp5Engine = "java" | "kordoc";

/**
 * HWP 5.x(OLE2)를 어느 엔진으로 처리할지 결정한다.
 *
 * 기본값은 검증된 Java 경로다. `PAPER_MD_STUDIO_HWP_ENGINE=kordoc`일 때만
 * kordoc 직파싱으로 바꾼다 — Java jar+JRE 번들(설치본 수십 MB)을 걷어낼 수
 * 있는지 A/B로 재기 위한 실험 플래그이며, 아직 기본값이 아니다.
 *
 * 알 수 없는 값은 조용히 무시하고 Java로 떨어뜨린다. 오타 하나로 변환 엔진이
 * 바뀌는 것보다 검증된 경로를 유지하는 편이 안전하다.
 */
export function resolveHwp5Engine(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Hwp5Engine {
  return env[HWP_ENGINE_ENV] === "kordoc" ? "kordoc" : "java";
}

/**
 * core 패키지 내 hwp-to-hwpx.jar 경로를 탐색한다.
 *
 * 탐색 순서:
 *   1. PAPER_MD_STUDIO_HWP_JAR 환경변수 (최우선)
 *   2. src/parsers/*.ts 기준 상대경로 (개발 모드)
 *   3. dist/index.js 기준 상대경로 (빌드 산출물)
 *   4. 패키지 루트 기준 상대경로
 */
async function resolveJarPath(): Promise<string> {
  const override = process.env[JAR_ENV_OVERRIDE];
  if (override) {
    try {
      await access(override);
      return override;
    } catch {
      throw new Error(
        `${JAR_ENV_OVERRIDE}에 지정된 jar 파일을 찾을 수 없습니다: ${override}`,
      );
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "resources", JAR_FILE_NAME), // src/parsers/ → packages/core/resources
    join(here, "..", "resources", JAR_FILE_NAME), // dist/ → packages/core/resources
    join(here, "resources", JAR_FILE_NAME),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 다음 후보 시도
    }
  }

  throw new Error(
    `HWP 변환 jar 파일을 찾을 수 없습니다. ${JAR_ENV_OVERRIDE} 환경변수로 경로를 지정하거나 ` +
      `packages/core/resources/${JAR_FILE_NAME} 파일이 존재하는지 확인하세요.`,
  );
}

/**
 * 시스템의 java 실행 파일 경로를 결정.
 * JAVA_HOME 우선, 실패 시 PATH의 'java'. Windows에서는 .exe를 붙인다.
 */
function resolveJavaExecutable(): string {
  const javaBinary = process.platform === "win32" ? "java.exe" : "java";
  const javaHome = process.env[JAVA_ENV];
  if (javaHome) {
    return join(javaHome, "bin", javaBinary);
  }
  return javaBinary;
}

/** 포맷 판별에 필요한 파일 앞부분 크기 — HWPML 판별이 최대 512바이트를 본다 */
const DETECT_PREFIX_BYTES = 1024;

/** 매직바이트 판별용으로 파일 앞부분만 읽는다 (대용량 HWP 전체 로드 방지). */
async function readFilePrefix(inputPath: string): Promise<Buffer> {
  const handle = await open(inputPath, "r");
  try {
    const buffer = Buffer.alloc(DETECT_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, DETECT_PREFIX_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

interface JavaRunResult {
  readonly code: number;
  readonly stderr: string;
}

function runJava(javaCmd: string, args: Array<string>): Promise<JavaRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaCmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderrChunks: Array<Buffer> = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "Java 런타임을 찾을 수 없습니다. JDK 11 이상을 설치하거나 " +
              `${JAVA_ENV} 환경변수를 설정해주세요.`,
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });
  });
}

/**
 * .hwp 확장자 파일의 파서.
 *
 * 확장자는 같아도 실제 포맷은 셋으로 갈린다 — 매직바이트로 분기한다:
 *   - HWP 3.x (1996~2002 단일 바이너리) → kordoc 파서
 *   - HWPML (XML 기반 .hwp)            → kordoc 파서
 *   - HWP 5.x (OLE2 바이너리)          → Java 툴체인으로 HWPX 선변환 후 HwpxParser
 *                                        (PAPER_MD_STUDIO_HWP_ENGINE=kordoc이면 직파싱)
 */
export class HwpParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const prefix = await readFilePrefix(inputPath);
    const detected = detectBinaryFormat(prefix);
    if (detected === "hwp3" || detected === "hwpml") {
      return await new KordocParser().parse(inputPath, options);
    }

    // HWP 5.x — K3 실험 플래그가 켜져 있으면 Java를 건너뛰고 kordoc이 직접 읽는다.
    if (resolveHwp5Engine() === "kordoc") {
      return await new KordocParser().parse(inputPath, options);
    }

    const jarPath = await resolveJarPath();
    const javaCmd = resolveJavaExecutable();

    const tmpDir = await mkdtemp(join(tmpdir(), "paper-md-studio-hwp-"));
    const baseName = basename(inputPath).replace(/\.[^.]+$/, "");
    const tmpHwpxPath = normalizeToNFC(join(tmpDir, `${baseName}.hwpx`));

    try {
      const result = await runJava(javaCmd, [
        "-jar",
        jarPath,
        inputPath,
        tmpHwpxPath,
      ]);

      if (result.code !== 0) {
        const detail = result.stderr.trim() || `종료 코드 ${result.code}`;
        throw new Error(`HWP → HWPX 변환 실패: ${detail}`);
      }

      const hwpxParser = new HwpxParser();
      return await hwpxParser.parse(tmpHwpxPath, options);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
