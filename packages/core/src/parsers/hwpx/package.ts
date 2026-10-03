import { type UnzipFileInfo, unzipSync } from "fflate";
import { isImagePath } from "./images.js";
import {
  MAX_INFLATED_BYTES,
  MAX_XML_BYTES,
  MAX_ZIP_ENTRIES,
} from "./limits.js";

/**
 * HWPX(ZIP) 패키지 읽기 — 상한 검사 후 파서가 쓰는 항목만 푼다.
 *
 * fflate 의 unzipSync 는 항목마다 ZIP 이 **스스로 적은** 원본 크기만큼 버퍼를
 * 먼저 잡고(`new Uint8Array(originalSize)`), 걸러내지 않으면 미리보기·스크립트
 * 같은 쓰지 않는 항목까지 전부 푼다. 그래서 수백 KB 짜리 파일이 수 GB 를
 * 요구할 수 있었다. 먼저 중앙 디렉터리만 읽어(압축 해제 없음) 항목 수와 선언
 * 크기를 검사하고, 통과하면 XML·그림만 푼다. 선언보다 실제로 더 풀리는 항목은
 * fflate 가 선언 크기에서 자르므로 메모리는 선언 크기로 묶인다.
 */

const MIB = 1024 * 1024;

/** 상한을 넘어 변환을 거부할 때의 오류 — .hwp 경로는 TOO_LARGE 로 옮긴다 */
export class HwpxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HwpxLimitError";
  }
}

export interface HwpxPackage {
  /** 푼 항목 — XML(본문·머리·목차)과 그림 */
  readonly files: Readonly<Record<string, Uint8Array>>;
  /** ZIP 안 모든 항목 이름 (풀지 않은 것 포함 — WMF/EMF 판별용) */
  readonly entryNames: ReadonlyArray<string>;
}

type EntryKind = "xml" | "image";

/** 메타데이터·미리보기는 본문 변환에 쓰지 않는다 */
const UNUSED_FOLDERS = ["meta-inf/", "preview/"];
const XML_PATTERN = /\.(xml|hpf)$/;

function entryKind(name: string): EntryKind | null {
  const lower = name.toLowerCase();
  if (UNUSED_FOLDERS.some((folder) => lower.startsWith(folder))) return null;
  if (XML_PATTERN.test(lower)) return "xml";
  return isImagePath(lower) ? "image" : null;
}

function megabytes(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)}MB`;
}

function tooManyEntries(): HwpxLimitError {
  return new HwpxLimitError(
    `HWPX 파일 안 항목이 너무 많습니다 (최대 ${MAX_ZIP_ENTRIES.toLocaleString("ko-KR")}개). 문서가 손상되었거나 악의적으로 만들어졌을 수 있습니다.`,
  );
}

function tooLarge(detail: string): HwpxLimitError {
  return new HwpxLimitError(
    `HWPX 압축을 풀면 비정상적으로 커지는 데이터가 있어 변환을 중단했습니다 (${detail}). 문서가 손상되었거나 악의적으로 만들어졌을 수 있습니다.`,
  );
}

function openFailed(err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(
    `HWPX 파일을 열 수 없습니다 (손상되었거나 ZIP 형식이 아닙니다): ${detail}`,
  );
}

/** fflate 호출 — 상한 오류는 그대로, 라이브러리 오류는 한국어로 감싼다 */
function guardedUnzip(
  data: Uint8Array,
  filter: (file: UnzipFileInfo) => boolean,
): Record<string, Uint8Array> {
  try {
    return unzipSync(data, { filter });
  } catch (err) {
    if (err instanceof HwpxLimitError) throw err;
    throw openFailed(err);
  }
}

/** 중앙 디렉터리만 읽어 항목 목록을 얻는다 — 압축은 풀지 않는다 (항목 수 상한 포함) */
export function listEntries(data: Uint8Array): Array<UnzipFileInfo> {
  const entries: Array<UnzipFileInfo> = [];
  guardedUnzip(data, (file) => {
    if (entries.length >= MAX_ZIP_ENTRIES) throw tooManyEntries();
    entries.push(file);
    return false;
  });
  return entries;
}

/** 풀 항목을 고르고 선언 크기 합계가 상한 안인지 본다 */
function selectEntries(entries: ReadonlyArray<UnzipFileInfo>): Set<string> {
  const selected = new Set<string>();
  let xmlBytes = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    const kind = entryKind(entry.name);
    if (!kind) continue;
    selected.add(entry.name);
    totalBytes += entry.originalSize;
    if (kind === "xml") xmlBytes += entry.originalSize;
  }
  if (xmlBytes > MAX_XML_BYTES) {
    throw tooLarge(
      `본문 XML ${megabytes(xmlBytes)}, 최대 ${megabytes(MAX_XML_BYTES)}`,
    );
  }
  if (totalBytes > MAX_INFLATED_BYTES) {
    throw tooLarge(
      `풀 내용 ${megabytes(totalBytes)}, 최대 ${megabytes(MAX_INFLATED_BYTES)}`,
    );
  }
  return selected;
}

/** HWPX 바이트를 상한 검사 후 필요한 항목만 풀어 돌려준다 */
export function readHwpxPackage(data: Uint8Array): HwpxPackage {
  const entries = listEntries(data);
  const selected = selectEntries(entries);
  const files = guardedUnzip(data, (file) => selected.has(file.name));
  return { files, entryNames: entries.map((entry) => entry.name) };
}
