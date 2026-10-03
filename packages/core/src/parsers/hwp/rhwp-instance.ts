/**
 * rhwp(@rhwp/core, Rust→WASM) 모듈 인스턴스 — 지연 로드·공유·트랩 뒤 교체.
 *
 * - **지연 로드·한 번만 초기화**: 9.9MB WASM 컴파일은 .hwp 를 실제로 변환할 때만,
 *   인스턴스당 한 번 치른다 (서버·MCP 처럼 오래 사는 프로세스도 공유).
 * - **바이트로 초기화**: WASM 위치는 `createRequire(import.meta.url)` 로 찾고 파일
 *   바이트를 넘긴다. URL 을 넘기면 rhwp 글루가 `fetch` 를 쓰는데, Node 에서는
 *   `file:` URL 을 못 읽고 네트워크 접근 여지도 생긴다. 같은 코드가 소스(vitest)·
 *   core 빌드·CLI 번들(dist-bundle/node_modules/@rhwp/core) 어디서든 동작한다.
 * - **트랩 뒤 교체**: WASM 트랩(패닉·메모리 부족)은 wasm-bindgen 의 섀도 스택
 *   포인터를 되돌리지 않고 빌림 표식을 남긴다 — 같은 인스턴스를 계속 쓰면 다음
 *   변환이 엉뚱하게 실패한다(실측: 트랩 2번 뒤 40MB 정상 문서도 트랩). 글루는 상태를
 *   초기화하는 함수가 없고 `__wbg_init` 은 한 번 초기화되면 그대로 돌아오므로, 글루
 *   모듈을 쿼리 붙은 URL 로 **새로 import** 해 새 WASM 인스턴스를 만든다.
 *
 * 한계(오래 사는 호스트 — 서버·MCP): WASM 선형 메모리는 늘기만 하고 줄지 않아,
 * 한 인스턴스가 겪은 가장 큰 문서가 프로세스가 끝날 때까지 메모리 바닥이 된다.
 * 버린 인스턴스도 Node 가 ES 모듈을 내리지 않아 그 메모리를 돌려받지 못한다(트랩
 * 1번당 인스턴스 하나만큼 남는다). 입력 상한(`inflate-guard.ts`)이 그 크기를 묶을
 * 뿐이고, 근본 해결은 rhwp 를 워커(worker_threads·자식 프로세스)로 격리해 큰 입력·
 * 트랩 뒤 워커째 버리는 것이다.
 *
 * **교체 횟수 상한**(`MAX_RHWP_REPLACEMENTS`): 교체는 버린 인스턴스의 메모리를
 * 프로세스가 끝날 때까지 안고 가므로 무한정 둘 수 없다 — 트랩이 거듭된다는 것은
 * 엔진이 이미 불안정하다는 신호다. 상한을 넘으면 새 인스턴스를 만드는 대신
 * 한국어 오류로 빠르게 거부하고(서버·MCP 는 감독 프로세스가 재시작하도록), 입력
 * 상한이 막는 알려진 트랩 경로 밖의 미지 트랩이 메모리를 조용히 갉아먹는 것을 막는다.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { HwpConversionError } from "./errors.js";

export type RhwpModule = typeof import("@rhwp/core");

const GLUE_SPECIFIER = "@rhwp/core";
const WASM_SPECIFIER = "@rhwp/core/rhwp_bg.wasm";
const requireHere = createRequire(import.meta.url);

/**
 * 프로세스 수명 동안 허용하는 인스턴스 교체 횟수. 넘으면 엔진이 불안정하다고
 * 보고 거부한다 — 버린 인스턴스마다 WASM 메모리가 남으므로(실측: 256MB 쓴
 * 인스턴스 4개가 GC 후에도 ≈1GB) 무한 교체는 메모리를 잠식한다. 3 은 일시적
 * 불안정은 넘기되(교체 3번 안에 보통 복구된다) 트랩 폭주는 끊는 타협값이다.
 */
export const MAX_RHWP_REPLACEMENTS = 3;

/** 지금까지의 인스턴스 교체 횟수 (버린 활성 인스턴스 수) */
let replacementCount = 0;

let nextGeneration = 0;
// 프로세스 수명 동안 공유하는 캐시. 서버·MCP 같은 오래 사는 호스트에서는 이
// 인스턴스가 겪은 최대 문서 크기만큼 WASM 메모리가 바닥으로 남는다(줄지 않음).
// 워커 격리 전까지는 입력 상한이 그 바닥을 묶는다 — 위 모듈 설명 참고.
let pending: Promise<RhwpModule> | null = null;
let current: RhwpModule | null = null;
const discarded = new WeakSet<RhwpModule>();

/** 첫 인스턴스는 평범한 import, 교체 인스턴스는 쿼리로 구분한 새 모듈 */
async function importGlue(generation: number): Promise<RhwpModule> {
  if (generation === 0) {
    return import("@rhwp/core");
  }
  const url = pathToFileURL(requireHere.resolve(GLUE_SPECIFIER));
  url.searchParams.set("instance", String(generation));
  const glue: RhwpModule = await import(/* @vite-ignore */ url.href);
  return glue;
}

async function initRhwp(generation: number): Promise<RhwpModule> {
  const wasmPath = requireHere.resolve(WASM_SPECIFIER);
  const [rhwp, wasm] = await Promise.all([
    importGlue(generation),
    readFile(wasmPath),
  ]);
  await rhwp.default({ module_or_path: wasm });
  current = rhwp;
  return rhwp;
}

/** rhwp 모듈을 불러와 초기화한다. 동시 호출도 같은 초기화를 공유한다 */
export function loadRhwp(): Promise<RhwpModule> {
  if (pending === null) {
    if (replacementCount > MAX_RHWP_REPLACEMENTS) {
      // 캐시하지 않는다 — 매 호출마다 같은 오류를 내 프로세스가 재시작될 때까지 거부한다
      return Promise.reject(
        new HwpConversionError(
          "CONVERSION_FAILED",
          `변환 엔진이 거듭 비정상 종료해(${replacementCount}회 교체) 불안정합니다. 서버·MCP 프로세스를 다시 시작해주세요`,
        ),
      );
    }
    pending = initRhwp(nextGeneration++).catch((err: unknown) => {
      // 실패를 캐시하지 않는다 — 일시적 I/O 오류 뒤 재시도할 수 있게
      pending = null;
      const detail = err instanceof Error ? err.message : String(err);
      throw new HwpConversionError(
        "CONVERSION_FAILED",
        `HWP 변환 엔진을 불러오지 못했습니다: ${detail}`,
      );
    });
  }
  return pending;
}

/** 트랩이 난 인스턴스를 버린다 — 다음 `loadRhwp` 는 새 인스턴스를 만든다 */
export function discardRhwp(rhwp: RhwpModule): void {
  discarded.add(rhwp);
  if (current === rhwp) {
    current = null;
    pending = null;
    replacementCount += 1;
  }
}

/** 교체 횟수를 초기화한다 — 테스트 전용(한 테스트가 독립 프로세스를 흉내 낸다) */
export function resetRhwpReplacementCountForTest(): void {
  replacementCount = 0;
}

/**
 * 버린 인스턴스인지. 호출자는 `await loadRhwp()` 직후 **같은 동기 구간에서**
 * 확인해야 한다 — 기다리는 사이 다른 변환이 트랩으로 같은 인스턴스를 버렸을 수 있다.
 */
export function isDiscarded(rhwp: RhwpModule): boolean {
  return discarded.has(rhwp);
}
