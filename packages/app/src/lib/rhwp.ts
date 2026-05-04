/**
 * @rhwp/core (Rust+WASM) 부트스트랩.
 *
 * - WASM 바이너리는 Vite의 `?url` 임포트로 정적 자산화 → Tauri 빌드에 동봉.
 * - HWP 텍스트 폭 측정은 브라우저 Canvas API에 의존하므로
 *   `globalThis.measureTextWidth`를 init 전에 반드시 등록해야 한다.
 *   (rhwp 0.7.x README 필수 사양)
 */

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

/** 파일 경로를 읽어 HwpDocument를 생성한다. NFC 정규화 포함. */
export async function loadHwpDocument(filePath: string): Promise<HwpDocument> {
  await initRhwp();
  const normalized = filePath.normalize("NFC");
  const bytes = await readFileAsBytes(normalized);
  return new HwpDocument(bytes);
}

export type { HwpDocument };
