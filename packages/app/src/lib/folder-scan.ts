import { readDir } from "@tauri-apps/plugin-fs";
import { isSupportedFile } from "../store/file-store";

/** 폴더 스캔 결과: 지원 문서 파일 + 트리 표시용 그룹 경로 */
export interface ScannedFile {
  readonly path: string;
  /** 선택한 루트 폴더명부터의 상대 그룹 경로 (예: "샘플/하위폴더") */
  readonly groupDir: string;
}

/** 과도한 재귀 방지 한도 */
const MAX_DEPTH = 8;
const MAX_FILES = 500;

function baseName(path: string): string {
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const trimmed = path.endsWith(sep) ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf(sep);
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * 폴더를 재귀 탐색해 지원하는 문서 파일 목록을 반환한다.
 * 숨김 항목(.으로 시작)은 건너뛰고, 깊이·파일 수 한도를 둔다.
 */
export async function scanFolderForDocuments(
  rootPath: string,
): Promise<Array<ScannedFile>> {
  const sep = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  const results: Array<ScannedFile> = [];
  await walkDirectory(rootPath, baseName(rootPath), 0, sep, results);
  return results;
}

async function walkDirectory(
  dir: string,
  groupDir: string,
  depth: number,
  sep: string,
  results: Array<ScannedFile>,
): Promise<void> {
  if (depth > MAX_DEPTH || results.length >= MAX_FILES) return;

  const entries = await readDir(dir);
  const sorted = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, "ko"),
  );

  for (const entry of sorted) {
    if (results.length >= MAX_FILES) return;
    if (entry.name.startsWith(".")) continue;

    const fullPath = `${dir}${sep}${entry.name}`;
    if (entry.isDirectory) {
      await walkDirectory(
        fullPath,
        `${groupDir}/${entry.name}`,
        depth + 1,
        sep,
        results,
      );
    } else if (entry.isFile && isSupportedFile(entry.name)) {
      results.push({ path: fullPath, groupDir });
    }
  }
}
