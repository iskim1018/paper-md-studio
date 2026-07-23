import { stat } from "@tauri-apps/plugin-fs";
import { isSupportedFile } from "../store/file-store";
import { type ScannedFile, scanFolderForDocuments } from "./folder-scan";

/** 드롭된 경로를 스토어에 반영하는 콜백 모음 */
export interface DroppedPathSinks {
  readonly addFiles: (paths: ReadonlyArray<string>) => void;
  readonly addScannedFiles: (items: ReadonlyArray<ScannedFile>) => number;
}

/**
 * 드래그 앤 드롭된 경로들을 파일/폴더로 분류해 추가한다.
 * 지원 확장자 파일은 바로 추가하고, 폴더는 재귀 스캔해 문서를 수집한다.
 * 그 외(미지원 파일, 접근 불가 경로)는 무시한다.
 */
export async function addDroppedPaths(
  paths: ReadonlyArray<string>,
  { addFiles, addScannedFiles }: DroppedPathSinks,
): Promise<void> {
  const filePaths = paths.filter(isSupportedFile);
  if (filePaths.length > 0) {
    addFiles(filePaths);
  }

  const candidates = paths.filter((p) => !isSupportedFile(p));
  for (const path of candidates) {
    const scanned = await scanDroppedFolder(path);
    if (scanned.length > 0) {
      addScannedFiles(scanned);
    }
  }
}

async function scanDroppedFolder(path: string): Promise<Array<ScannedFile>> {
  try {
    const info = await stat(path);
    if (!info.isDirectory) return [];
    return await scanFolderForDocuments(path);
  } catch {
    // stat/스캔 실패(권한 등) 시 해당 경로는 건너뛴다
    return [];
  }
}
