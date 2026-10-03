/**
 * rhwp 로 HWP→HWPX 변환 (인스턴스 관리는 `rhwp-instance.ts`).
 *
 * - **항상 free**: WASM 메모리는 한 번 늘면 줄지 않는다. 문서·내보내기 결과를
 *   해제하지 않으면 변환마다 힙이 쌓인다(실측 54MB→167MB/20회).
 * - **free 실패는 매핑된 오류를 덮지 않는다**: 트랩이 &self 메서드 안에서 나면
 *   빌림 표식이 남아 뒤이은 free 가 "borrowed" 영어 오류를 던진다. finally 의
 *   예외가 catch 에서 만든 한국어 오류를 대신하면 안 되므로 free 오류는 삼키고,
 *   그 인스턴스는 믿을 수 없으니 버린다(그 문서는 어차피 해제할 수 없다).
 * - `globalThis.measureTextWidth` 는 설정하지 않는다 — rhwp 0.8.x 는 그 전역을
 *   부르지 않는다(글루에 0회 등장, 호출 계측 0회).
 */

import {
  decodeHwpml,
  HWPML_FALLBACK_VERSION,
  readHwpmlVersion,
  rewriteHwpmlVersion,
} from "@paper-md-studio/md-utils";
import { contentLossToWarnings } from "./content-loss.js";
import {
  HwpConversionError,
  isWasmRuntimeError,
  toHwpConversionError,
} from "./errors.js";
import {
  discardRhwp,
  isDiscarded,
  loadRhwp,
  type RhwpModule,
} from "./rhwp-instance.js";

export { loadRhwp } from "./rhwp-instance.js";

type HwpDocument = InstanceType<RhwpModule["HwpDocument"]>;
type DocumentExport = ReturnType<HwpDocument["exportHwpxWithReport"]>;

export interface RhwpResult {
  /** rhwp 가 내보낸 HWPX(zip) 바이트 */
  readonly hwpx: Uint8Array;
  /** 한국어 경고 (content-loss·버전 대체 등) */
  readonly warnings: Array<string>;
}

/**
 * 엔진이 호출 도중 중단됐는지 — rhwp 의 정상 거부는 문자열이다. 트랩(RuntimeError)
 * 과 스택·메모리 고갈(RangeError) 뒤에는 인스턴스 상태를 믿을 수 없다.
 */
function isEngineAbort(err: unknown): boolean {
  return isWasmRuntimeError(err) || err instanceof RangeError;
}

/** free 하되 실패는 삼킨다. 실패했으면 false */
function freeQuietly(resource: { free(): void } | undefined): boolean {
  try {
    resource?.free();
    return true;
  } catch {
    // 의도적으로 무시 — 위 모듈 설명 참고. 호출자가 인스턴스를 버린다.
    return false;
  }
}

function exportHwpx(rhwp: RhwpModule, data: Uint8Array): RhwpResult {
  let doc: HwpDocument | undefined;
  let exported: DocumentExport | undefined;
  try {
    doc = new rhwp.HwpDocument(data);
    exported = doc.exportHwpxWithReport();
    const hwpx = exported.takeBytes();
    return { hwpx, warnings: contentLossToWarnings(exported.contentLoss()) };
  } catch (err) {
    if (isEngineAbort(err)) {
      discardRhwp(rhwp);
    }
    throw toHwpConversionError(err);
  } finally {
    const freed = [freeQuietly(exported), freeQuietly(doc)];
    if (freed.includes(false)) {
      discardRhwp(rhwp);
    }
  }
}

/** HWP 5.0·HWP 3.0·HWPML 바이트를 HWPX 로 내보낸다 (한 번 시도) */
export async function convertWithRhwp(data: Uint8Array): Promise<RhwpResult> {
  let rhwp = await loadRhwp();
  while (isDiscarded(rhwp)) {
    rhwp = await loadRhwp();
  }
  return exportHwpx(rhwp, data);
}

/** rhwp 가 받아들이는 HWPML 버전으로 바꿔 넣을 값 (앱 미리보기와 공유) */
export const FALLBACK_HWPML_VERSION = HWPML_FALLBACK_VERSION;

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
