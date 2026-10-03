import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { detectHwpFormat, readLegacyVersion } from "./hwp/detect.js";
import { HwpConversionError, toHwpConversionError } from "./hwp/errors.js";
import { parseHwpWithJava } from "./hwp/java-engine.js";
import { precheckHwp3, precheckHwp5 } from "./hwp/precheck.js";
import {
  convertHwpmlWithRhwp,
  convertWithRhwp,
  type RhwpResult,
} from "./hwp/rhwp-loader.js";
import { HwpxParser } from "./hwpx-parser.js";

/** HWP 5.0 처리 엔진 선택 */
const HWP_ENGINE_ENV = "PAPER_MD_STUDIO_HWP_ENGINE";

export type Hwp5Engine = "rhwp" | "java";

/**
 * HWP 5.0(OLE2)를 어느 엔진으로 처리할지 결정한다.
 *
 * **기본값은 rhwp 다.** rhwp(WASM)가 HWP 를 HWPX 로 내보내고, 그 뒤는 .hwpx 와
 * 같은 HwpxParser 를 탄다 — Java 경로와 파이프라인 모양이 같다. Java 경로는
 * `PAPER_MD_STUDIO_HWP_ENGINE=java` 로 아직 쓸 수 있다(HWP 5.0 에만 적용).
 *
 * 알 수 없는 값(이전 기본값 "kordoc" 포함)은 조용히 기본값으로 떨어뜨린다.
 * 오타 하나로 변환 엔진이 바뀌면 안 된다.
 */
export function resolveHwp5Engine(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Hwp5Engine {
  return env[HWP_ENGINE_ENV] === "java" ? "java" : "rhwp";
}

/**
 * rhwp 가 내보낸 HWPX 를 HwpxParser 로 읽는다.
 * HwpxParser 가 바이트 입력(parseBytes)을 받게 되면 임시 파일 없이 이 함수만 바꾼다.
 */
async function parseHwpxBytes(
  hwpx: Uint8Array,
  options: ParseOptions,
): Promise<ParseResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "paper-md-studio-hwp-"));
  try {
    const tmpPath = join(tmpDir, "document.hwpx");
    await writeFile(tmpPath, hwpx);
    return await new HwpxParser().parse(tmpPath, options);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** 사전 검사·변환 엔진 경고를 HwpxParser 결과의 경고 앞에 붙인다 */
function withWarnings(
  result: ParseResult,
  warnings: ReadonlyArray<string>,
): ParseResult {
  const merged = [...warnings, ...(result.warnings ?? [])];
  return merged.length > 0 ? { ...result, warnings: merged } : result;
}

/**
 * rhwp 로 HWPX 를 만든 뒤 HwpxParser 로 읽는다. 변환은 함수로 받는다 — 사전
 * 검사가 끝나기 전에 변환이 시작되는 일(인자 평가 순서 실수)을 막기 위해서다.
 */
async function parseViaRhwp(
  convert: () => Promise<RhwpResult>,
  precheckWarnings: ReadonlyArray<string>,
  options: ParseOptions,
): Promise<ParseResult> {
  const { hwpx, warnings } = await convert();
  const result = await parseHwpxBytes(hwpx, options);
  return withWarnings(result, [...precheckWarnings, ...warnings]);
}

/**
 * HWPX(ZIP)를 .hwp 로 저장한 파일 — .hwpx 와 똑같이 HwpxParser 로 읽는다.
 * DOCX·XLSX 도 ZIP 이므로 HWPX 본문 폴더(Contents/)가 있는지 먼저 본다.
 */
async function parseZipAsHwpx(
  inputPath: string,
  data: Uint8Array,
  options: ParseOptions,
): Promise<ParseResult> {
  const names: Array<string> = [];
  try {
    unzipSync(data, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    throw new HwpConversionError("CORRUPTED", "ZIP 구조를 읽을 수 없습니다");
  }
  if (!names.some((name) => name.toLowerCase().startsWith("contents/"))) {
    throw new HwpConversionError(
      "UNSUPPORTED",
      "HWPX 가 아닌 ZIP 문서(DOCX·XLSX 등)입니다. 확장자를 확인해주세요",
    );
  }
  return await new HwpxParser().parse(inputPath, options);
}

/** 보안 컨테이너 머리말 판별에 넘길 앞부분 크기 */
const DRM_SNIFF_BYTES = 4096;

/**
 * 알아보지 못한 파일. 우리가 모르는 보안 컨테이너(SoftCamp·Fasoo 등 DRM)면
 * rhwp 가 머리말로 알아보므로, **앞 4KB 만** 넘겨 DRM 인지만 묻는다 — 전체를
 * 넘기면 사전 검사 없이 엔진이 내용을 풀게 된다.
 */
async function rejectUnknown(data: Uint8Array): Promise<never> {
  try {
    await convertWithRhwp(data.subarray(0, DRM_SNIFF_BYTES));
  } catch (err) {
    const error = toHwpConversionError(err);
    if (error.code === "DRM_PROTECTED") {
      throw error;
    }
  }
  throw new HwpConversionError("UNSUPPORTED");
}

/**
 * .hwp 확장자 파일의 파서.
 *
 * 확장자는 같아도 실제 포맷은 여럿이다 — 매직바이트로 분기한다:
 *   - HWP 5.0 (OLE2)  → 사전 검사 → rhwp(기본) 또는 Java → HWPX → HwpxParser
 *   - HWP 3.0         → 사전 검사 → rhwp → HWPX → HwpxParser
 *   - HWPML (XML)     → rhwp(버전 대체 재시도) → HWPX → HwpxParser
 *   - HWPX (ZIP)      → HwpxParser (.hwpx 와 같은 결과)
 *   - 빈 파일·옛 버전·그 밖 → 엔진을 부르지 않고 한국어 오류
 */
export class HwpParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const data = new Uint8Array(await readFile(inputPath));
    const format = detectHwpFormat(data);
    switch (format) {
      case "empty":
        throw new HwpConversionError("EMPTY");
      case "hwp-legacy":
        throw new HwpConversionError(
          "LEGACY_VERSION",
          `문서 버전: ${readLegacyVersion(data)}`,
        );
      case "unknown":
        return await rejectUnknown(data);
      case "zip":
        return await parseZipAsHwpx(inputPath, data, options);
      case "hwpml":
        return await parseViaRhwp(
          () => convertHwpmlWithRhwp(data),
          [],
          options,
        );
      case "hwp3": {
        const warnings = precheckHwp3(data);
        return await parseViaRhwp(
          () => convertWithRhwp(data),
          warnings,
          options,
        );
      }
      case "hwp5": {
        const warnings = precheckHwp5(data);
        if (resolveHwp5Engine() === "java") {
          const result = await parseHwpWithJava(inputPath, options);
          return withWarnings(result, warnings);
        }
        return await parseViaRhwp(
          () => convertWithRhwp(data),
          warnings,
          options,
        );
      }
    }
  }
}
