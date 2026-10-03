/**
 * rhwp(@rhwp/core, Rust→WASM) 로더와 HWP→HWPX 변환.
 *
 * - **지연 로드·한 번만 초기화**: 9.9MB WASM 컴파일은 .hwp 를 실제로 변환할 때만,
 *   프로세스당 한 번 치른다 (서버·MCP 처럼 오래 사는 프로세스도 공유).
 * - **바이트로 초기화**: WASM 위치는 `createRequire(import.meta.url)` 로 찾고 파일
 *   바이트를 넘긴다. URL 을 넘기면 rhwp 글루가 `fetch` 를 쓰는데, Node 에서는
 *   `file:` URL 을 못 읽고 네트워크 접근 여지도 생긴다. 같은 코드가 소스(vitest)·
 *   core 빌드·CLI 번들(dist-bundle/node_modules/@rhwp/core) 어디서든 동작한다.
 * - **항상 free**: WASM 메모리는 한 번 늘면 줄지 않는다. 문서·내보내기 결과를
 *   해제하지 않으면 변환마다 힙이 쌓인다(실측 54MB→167MB/20회).
 * - `globalThis.measureTextWidth` 는 설정하지 않는다 — rhwp 0.8.x 는 그 전역을
 *   부르지 않는다(글루에 0회 등장, 호출 계측 0회).
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { contentLossToWarnings } from "./content-loss.js";
import { HwpConversionError, toHwpConversionError } from "./errors.js";
import { decodeHwpml, readHwpmlVersion, rewriteHwpmlVersion } from "./hwpml.js";

type RhwpModule = typeof import("@rhwp/core");
type HwpDocument = InstanceType<RhwpModule["HwpDocument"]>;
type DocumentExport = ReturnType<HwpDocument["exportHwpxWithReport"]>;

export interface RhwpResult {
  /** rhwp 가 내보낸 HWPX(zip) 바이트 */
  readonly hwpx: Uint8Array;
  /** 한국어 경고 (content-loss·버전 대체 등) */
  readonly warnings: Array<string>;
}

const WASM_SPECIFIER = "@rhwp/core/rhwp_bg.wasm";

let modulePromise: Promise<RhwpModule> | null = null;

async function initRhwp(): Promise<RhwpModule> {
  const wasmPath = createRequire(import.meta.url).resolve(WASM_SPECIFIER);
  const [rhwp, wasm] = await Promise.all([
    import("@rhwp/core"),
    readFile(wasmPath),
  ]);
  await rhwp.default({ module_or_path: wasm });
  return rhwp;
}

/** rhwp 모듈을 불러와 초기화한다. 동시 호출도 같은 초기화를 공유한다 */
export function loadRhwp(): Promise<RhwpModule> {
  if (modulePromise === null) {
    modulePromise = initRhwp().catch((err: unknown) => {
      // 실패를 캐시하지 않는다 — 일시적 I/O 오류 뒤 재시도할 수 있게
      modulePromise = null;
      const detail = err instanceof Error ? err.message : String(err);
      throw new HwpConversionError(
        "CONVERSION_FAILED",
        `HWP 변환 엔진을 불러오지 못했습니다: ${detail}`,
      );
    });
  }
  return modulePromise;
}

/** HWP 5.0·HWP 3.0·HWPML 바이트를 HWPX 로 내보낸다 (한 번 시도) */
export async function convertWithRhwp(data: Uint8Array): Promise<RhwpResult> {
  const rhwp = await loadRhwp();
  let doc: HwpDocument | undefined;
  let exported: DocumentExport | undefined;
  try {
    doc = new rhwp.HwpDocument(data);
    exported = doc.exportHwpxWithReport();
    const hwpx = exported.takeBytes();
    return { hwpx, warnings: contentLossToWarnings(exported.contentLoss()) };
  } catch (err) {
    throw toHwpConversionError(err);
  } finally {
    exported?.free();
    doc?.free();
  }
}

/** rhwp 가 받아들이는 HWPML 버전으로 바꿔 넣을 값 */
export const FALLBACK_HWPML_VERSION = "2.91";

function versionFallbackWarning(original: string | undefined): string {
  const tail = `${FALLBACK_HWPML_VERSION}로 간주해 변환했습니다. 일부 내용이 원본과 다를 수 있습니다.`;
  return original
    ? `HWPML 버전 ${original}은(는) 직접 지원하지 않아 ${tail}`
    : `HWPML 버전 정보가 없어 ${tail}`;
}

/**
 * 버전 탓에 거부됐는지. rhwp 는 버전 문자열이 목록(2.1·2.9·2.91)에 없으면
 * "지원하지 않는 HWPML 버전", Version 속성이 비었거나 없으면 아예 형식을 못
 * 알아본다(UNSUPPORTED).
 */
function isVersionRejection(
  error: HwpConversionError,
  original: string | undefined,
): boolean {
  if (error.code === "HWPML_VERSION") {
    return true;
  }
  return error.code === "UNSUPPORTED" && !original;
}

/**
 * HWPML 을 변환하되, 버전 탓에 거부되면 루트 Version 을 2.91 로 바꿔 한 번 더
 * 시도한다. rhwp 의 HML 리더는 버전 값으로 분기하지 않고(태그 이름으로만 해석)
 * 버전은 메타데이터로만 흘린다 — 그래서 대체해도 해석 경로는 같다. 다만 실물
 * 2.8 문서로 검증하지 못했으므로 경고로 알린다. HEAD 가 없으면 버전만 고쳐서는
 * 열리지 않으므로 원래 오류를 그대로 낸다.
 */
export async function convertHwpmlWithRhwp(
  data: Uint8Array,
): Promise<RhwpResult> {
  try {
    return await convertWithRhwp(data);
  } catch (err) {
    const error = toHwpConversionError(err);
    const original = readHwpmlVersion(decodeHwpml(data)) || undefined;
    if (!isVersionRejection(error, original)) {
      throw error;
    }
    const rewritten = rewriteHwpmlVersion(data, FALLBACK_HWPML_VERSION);
    if (rewritten === null) {
      throw new HwpConversionError(
        "HWPML_VERSION",
        `문서 버전: ${original ?? "없음"}`,
      );
    }
    const retried = await convertWithRhwp(rewritten);
    return {
      hwpx: retried.hwpx,
      warnings: [versionFallbackWarning(original), ...retried.warnings],
    };
  }
}
