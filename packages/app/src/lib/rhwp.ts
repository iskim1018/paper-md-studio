/**
 * @rhwp/core (Rust+WASM) 부트스트랩.
 *
 * - WASM 바이너리는 Vite의 `?url` 임포트로 정적 자산화 → Tauri 빌드에 동봉.
 * - HWP 텍스트 폭 측정은 브라우저 Canvas API에 의존하므로
 *   `globalThis.measureTextWidth`를 init 전에 반드시 등록해야 한다.
 *   (rhwp 0.7.x README 필수 사양)
 */

import {
  decodeHwpml,
  HWPML_FALLBACK_VERSION,
  HWPML_VERSION_REJECTION,
  readHwpmlVersion,
  rewriteHwpmlVersion,
} from "@paper-md-studio/md-utils";
import init, { HwpDocument } from "@rhwp/core";
import wasmUrl from "@rhwp/core/rhwp_bg.wasm?url";
import { readFileAsBytes } from "./file-reader";

declare global {
  // rhwp WASM이 호출하는 텍스트 폭 측정 콜백
  var measureTextWidth: ((font: string, text: string) => number) | undefined;
}

let measureCtx: CanvasRenderingContext2D | null = null;
let lastFont = "";

function ensureMeasureTextWidth(): void {
  if (typeof globalThis.measureTextWidth === "function") return;

  globalThis.measureTextWidth = (font: string, text: string): number => {
    if (!measureCtx) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return 0;
      measureCtx = ctx;
    }
    if (font !== lastFont) {
      measureCtx.font = font;
      lastFont = font;
    }
    return measureCtx.measureText(text).width;
  };
}

let initPromise: Promise<void> | null = null;

/** WASM 모듈을 1회만 초기화한다. */
export function initRhwp(): Promise<void> {
  if (initPromise) return initPromise;
  ensureMeasureTextWidth();
  initPromise = init({ module_or_path: wasmUrl }).then(() => undefined);
  return initPromise;
}

/** rhwp 가 던진 값의 문구 (rhwp 는 주로 문자열을 던진다) */
function thrownText(err: unknown): string {
  if (typeof err === "string") return err;
  return err instanceof Error ? err.message : "";
}

/**
 * HWPML 버전 탓에 거부됐을 때 2.91 로 바꾼 바이트. 대체할 수 없으면 null.
 * 변환 경로(core `convertHwpmlWithRhwp`)와 같은 규칙이다 — 목록에 없는 버전이거나,
 * Version 속성이 없어 rhwp 가 형식을 못 알아본 경우(UNSUPPORTED). HEAD 가 없거나
 * 루트가 HWPML 이 아니면 버전만 고쳐서는 열리지 않으므로 null.
 */
function hwpmlVersionFallback(
  err: unknown,
  bytes: Uint8Array,
): Uint8Array | null {
  const text = thrownText(err);
  const isVersionRejection =
    HWPML_VERSION_REJECTION.test(text) ||
    (text.includes("UNSUPPORTED_FILE_FORMAT") &&
      !readHwpmlVersion(decodeHwpml(bytes)));
  return isVersionRejection
    ? rewriteHwpmlVersion(bytes, HWPML_FALLBACK_VERSION)
    : null;
}

function openHwpDocument(bytes: Uint8Array): HwpDocument {
  try {
    return new HwpDocument(bytes);
  } catch (err) {
    const rewritten = hwpmlVersionFallback(err, bytes);
    if (rewritten === null) throw err;
    return new HwpDocument(rewritten);
  }
}

/**
 * 파일 경로를 읽어 HwpDocument를 생성한다. NFC 정규화 포함.
 * 미지원 HWPML 버전은 변환과 같이 2.91 로 간주해 한 번 더 연다 — 안 그러면 같은
 * 파일이 결과 패널에서는 변환되고 미리보기에서는 "읽을 수 없음"으로 갈린다.
 */
export async function loadHwpDocument(filePath: string): Promise<HwpDocument> {
  await initRhwp();
  const normalized = filePath.normalize("NFC");
  const bytes = await readFileAsBytes(normalized);
  return openHwpDocument(bytes);
}

export type { HwpDocument };
