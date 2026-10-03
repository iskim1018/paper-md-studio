import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import type { ParseOptions, ParseResult, Parser } from "../types.js";
import { detectHwpFormat, readLegacyVersion } from "./hwp/detect.js";
import { HwpConversionError, toHwpConversionError } from "./hwp/errors.js";
import { precheckHwp3, precheckHwp5 } from "./hwp/precheck.js";
import {
  convertHwpmlWithRhwp,
  convertWithRhwp,
  type RhwpResult,
} from "./hwp/rhwp-loader.js";
import { HwpxParser } from "./hwpx-parser.js";

const HANGUL = /[가-힣]/;

/**
 * HwpxParser 실행. .hwp 경로에서 나가는 오류는 모두 한국어 메시지의 Error
 * 여야 하므로, 한국어가 아닌 오류(zip·XML 라이브러리 문구 등)는 감싼다.
 */
async function runHwpxParser(
  data: Uint8Array,
  options: ParseOptions,
): Promise<ParseResult> {
  try {
    return await new HwpxParser().parseBytes(data, options);
  } catch (err) {
    if (err instanceof Error && HANGUL.test(err.message)) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new HwpConversionError(
      "CONVERSION_FAILED",
      `HWPX 해석 실패: ${detail}`,
    );
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
  const result = await runHwpxParser(hwpx, options);
  return withWarnings(result, [...precheckWarnings, ...warnings]);
}

/**
 * HWPX(ZIP)를 .hwp 로 저장한 파일 — .hwpx 와 똑같이 HwpxParser 로 읽는다.
 * DOCX·XLSX 도 ZIP 이므로 HWPX 본문 폴더(Contents/)가 있는지 먼저 본다.
 */
async function parseZipAsHwpx(
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
  return await runHwpxParser(data, options);
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
 *   - HWP 5.0 (OLE2)  → 사전 검사 → rhwp → HWPX → HwpxParser
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
        return await parseZipAsHwpx(data, options);
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
        return await parseViaRhwp(
          () => convertWithRhwp(data),
          warnings,
          options,
        );
      }
    }
  }
}
