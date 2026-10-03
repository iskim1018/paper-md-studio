/**
 * OLE2(복합 문서) 사전 검증기 — `CFB.read` 앞에서 돈다. 의존성 없음.
 *
 * `cfb` 1.2.2 는 적대적 OLE2 에 두 가지로 취약하다(둘 다 프로세스를 죽이는 OOM —
 * `catch` 로 못 잡는다):
 *   (a) `get_sector_list` 에 순환 검사가 없다 — 중간 체인을 가리키는 디렉터리
 *       항목 하나가 순환 FAT 를 만나면 무한 루프(27KB 파일이 "heap limit" 로 중단).
 *   (b) 중간 체인을 가리키는 항목마다 나머지 체인을 통째로 복사한다 — 2.3MB 파일이
 *       `CFB.read` 만으로 ≈2.4GB 를 잡는다.
 *   그리고 `make_sector_list` 는 뒤로 겹치는 FAT 에서 체인을 재순회해 O(n²) 로
 *   물질화하고(1MB 역방향 체인 → RSS 1.1GB), `build_full_paths` 는 디렉터리
 *   L/R/C 트리의 순환에서 폭주한다(형제 순환 → OOM). 모두 로컬 실측(2026-10-03).
 *
 * 이 검증기는 cfb 가 **물질화할 바이트**를 (복사 없이) 세고, 순환을 끊으며,
 * 합계를 파일 크기의 배수로 묶는다. 정상 OLE2 는 섹터가 겹치지 않아 값싸게
 * 통과하고(아래 배수 근거 참고), 적대적 파일은 빠르게 거부된다. cfb 자체가 아니라
 * 적대적 입력을 막으므로 다음 cfb 업그레이드도 보호한다.
 *
 * 배수 근거(2026-10-03 비공개 표본 — private/fixtures/*.hwp·private/doc·.xls
 * 픽스처 실측): cfb 가 물질화하는 바이트 ÷ 파일 크기의 최대 비율은 약 2.0 이었다
 * (섹터 사슬 1회 + fat-storage 스트림 재집계 1회). 8배는 그 4배 여유다.
 */

import { Ole2GuardError } from "./errors.js";
import {
  hasOle2Magic,
  type Ole2Context,
  parseOle2Context,
  readFatNext,
  readI32,
} from "./header.js";

/** 물질화 예산 = 파일 크기 × 이 값. 정상 최대 비율 ≈2.0 의 4배 여유 */
export const OLE2_MATERIALIZE_MULTIPLE = 8;
/** 아주 작은 파일에서 반올림으로 거부하지 않도록 둔 하한 */
const MIN_MATERIALIZE_BYTES = 1024 * 1024;
/** fat-storage 와 minifat-storage 를 가르는 크기 ([MS-CFB] 미니 스트림 컷오프) */
const MINI_CUTOFF = 4096;
/** 디렉터리 항목 하나의 크기 (바이트) */
const DIR_ENTRY_BYTES = 128;

type Charge = (bytes: number) => void;

function makeCharge(fileBytes: number): Charge {
  const budget = Math.max(
    MIN_MATERIALIZE_BYTES,
    fileBytes * OLE2_MATERIALIZE_MULTIPLE,
  );
  let spent = 0;
  return (bytes) => {
    spent += bytes;
    if (spent > budget) {
      throw new Ole2GuardError(
        "TOO_LARGE",
        "OLE2 섹터 사슬이 파일 크기에 비해 비정상적으로 큽니다",
      );
    }
  };
}

/**
 * `make_sector_list` 의 비용을 그대로 센다 — 모든 섹터를 시작점으로 보고 FAT 를
 * 따라가며(섹터마다 한 번 과금), 체인 안 순환은 cfb 처럼 방문 집합으로 끊는다.
 * 뒤로 겹치는 FAT 는 cfb 가 체인을 재순회하므로 여기서도 재순회해 같은 양을
 * 센다(그래서 O(n²) 폭탄이 예산에 걸린다). 과금이 예산을 넘으면 즉시 멈추므로
 * 내부 반복은 예산/ssz 로 묶인다.
 */
function chargeSectorChains(ctx: Ole2Context, charge: Charge): void {
  const { sectorCount, dirStart, ssz } = ctx;
  const checked = new Uint8Array(sectorCount);
  for (let i = 0; i < sectorCount; i++) {
    let k = i + dirStart;
    if (k >= sectorCount) {
      k -= sectorCount;
    }
    if (k < 0 || k >= sectorCount || checked[k] === 1) {
      continue;
    }
    const seen = new Set<number>();
    let j = k;
    while (j >= 0 && j < sectorCount && !seen.has(j)) {
      seen.add(j);
      checked[j] = 1;
      charge(ssz);
      const next = readFatNext(ctx, j);
      if (next === undefined) {
        break;
      }
      j = next;
    }
  }
}

interface DirEntry {
  readonly type: number;
  readonly left: number;
  readonly right: number;
  readonly child: number;
  readonly start: number;
  readonly size: number;
}

/** 디렉터리 사슬을 따라가며 128바이트 항목을 읽는다 (순환·경계 검사) */
function readDirectoryEntries(ctx: Ole2Context): Array<DirEntry> {
  const entries: Array<DirEntry> = [];
  const perSector = Math.floor(ctx.ssz / DIR_ENTRY_BYTES);
  const seen = new Set<number>();
  let j = ctx.dirStart;
  while (j >= 0 && j < ctx.sectorCount && !seen.has(j)) {
    seen.add(j);
    const base = (j + 1) * ctx.ssz;
    for (let e = 0; e < perSector; e++) {
      const off = base + e * DIR_ENTRY_BYTES;
      if (off + DIR_ENTRY_BYTES > ctx.data.length) {
        break;
      }
      entries.push({
        type: ctx.data[off + 66] ?? 0,
        left: readI32(ctx.data, off + 68),
        right: readI32(ctx.data, off + 72),
        child: readI32(ctx.data, off + 76),
        start: readI32(ctx.data, off + 116),
        size: readI32(ctx.data, off + 120) >>> 0,
      });
    }
    const next = readFatNext(ctx, j);
    if (next === undefined) {
      break;
    }
    j = next;
  }
  return entries;
}

/** 체인 하나를 따라가며 과금한다. 순환이면 손상(cfb `get_sector_list` 무한 루프 방지) */
function chargeChain(ctx: Ole2Context, start: number, charge: Charge): void {
  const seen = new Set<number>();
  let j = start;
  while (j >= 0 && j < ctx.sectorCount) {
    if (seen.has(j)) {
      throw new Ole2GuardError("CORRUPTED", "OLE2 FAT 사슬에 순환이 있습니다");
    }
    seen.add(j);
    charge(ctx.ssz);
    const next = readFatNext(ctx, j);
    if (next === undefined) {
      break;
    }
    j = next;
  }
}

/**
 * fat-storage 항목(크기 ≥ 4096)마다 체인을 따라 과금한다. cfb 의 `read_directory`
 * 는 시작이 체인 머리가 아닌(중간을 가리키는) 항목마다 나머지 체인을 통째로 복사
 * 하므로, 항목 수백 개가 같은 큰 체인을 가리키면 메모리가 터진다 (b). 여기서 항목
 * 마다 체인 길이를 과금하면 그 합계가 예산에 걸린다. 순환은 (a) 를 막는다.
 */
function chargeEntryChains(
  ctx: Ole2Context,
  entries: ReadonlyArray<DirEntry>,
  charge: Charge,
): void {
  for (const entry of entries) {
    if (
      entry.size < MINI_CUTOFF ||
      entry.start < 0 ||
      entry.start >= ctx.sectorCount
    ) {
      continue;
    }
    chargeChain(ctx, entry.start, charge);
  }
}

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/** root 에서 시작하는 L/R/C 트리를 색칠 DFS 로 훑는다 (회색 재방문 → 순환) */
function visitTreeFrom(
  root: number,
  entries: ReadonlyArray<DirEntry>,
  color: Uint8Array,
): void {
  const stack: Array<number> = [root];
  while (stack.length > 0) {
    const node = stack[stack.length - 1];
    if (node === undefined) {
      break;
    }
    if (color[node] === WHITE) {
      color[node] = GRAY;
    }
    const entry = entries[node];
    const next = entry ? nextUnvisitedChild(entry, color) : -1;
    if (next === -1) {
      color[node] = BLACK;
      stack.pop();
    } else {
      stack.push(next);
    }
  }
}

/**
 * 디렉터리 red-black 트리(L/R/C 포인터)에 순환이 없는지 본다. cfb 의
 * `build_full_paths` 는 형제·자식 순환에서 큐가 무한히 커져 OOM 난다 (c). 모든
 * 노드에서 색칠 DFS 로 역방향 간선(회색 재방문)을 찾으면 손상으로 거부한다.
 */
function assertNoDirectoryTreeCycle(entries: ReadonlyArray<DirEntry>): void {
  const color = new Uint8Array(entries.length);
  for (let root = 0; root < entries.length; root++) {
    if (color[root] === WHITE) {
      visitTreeFrom(root, entries, color);
    }
  }
}

/** L/R/C 중 아직 안 간 흰 노드를 하나 돌려준다. 회색(스택 위) 노드를 가리키면 순환 */
function nextUnvisitedChild(entry: DirEntry, color: Uint8Array): number {
  for (const target of [entry.left, entry.right, entry.child]) {
    if (target < 0 || target >= color.length) {
      continue;
    }
    if (color[target] === GRAY) {
      throw new Ole2GuardError(
        "CORRUPTED",
        "OLE2 디렉터리 트리에 순환이 있습니다",
      );
    }
    if (color[target] === WHITE) {
      return target;
    }
  }
  return -1;
}

/**
 * `CFB.read` 가 이 OLE2 를 안전하게 열 수 있는지 검증한다. 적대적이면
 * `Ole2GuardError`(CORRUPTED/TOO_LARGE)를 던지고, OLE2 가 아니면(zip·mad 등
 * cfb 의 다른 경로) 아무것도 하지 않는다. 호출자가 사유를 자기 오류로 옮긴다.
 */
export function assertSafeOle2(data: Uint8Array): void {
  if (!hasOle2Magic(data)) {
    return;
  }
  const ctx = parseOle2Context(data);
  const charge = makeCharge(data.length);
  chargeSectorChains(ctx, charge);
  const entries = readDirectoryEntries(ctx);
  assertNoDirectoryTreeCycle(entries);
  chargeEntryChains(ctx, entries, charge);
}

export type { Ole2GuardReason } from "./errors.js";
export { Ole2GuardError } from "./errors.js";
