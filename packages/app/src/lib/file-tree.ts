import type { FileItem } from "../store/file-store";

/** 파일 목록 트리의 폴더 노드 */
export interface FileTreeFolder {
  /** 폴더 표시명 (경로 마지막 세그먼트) */
  readonly name: string;
  /** groupDir 전체 경로 — 접힘 상태 등의 키로 사용 */
  readonly path: string;
  readonly folders: ReadonlyArray<FileTreeFolder>;
  readonly files: ReadonlyArray<FileItem>;
  /** 하위 전체(재귀) 파일 수 */
  readonly totalCount: number;
}

export interface FileTree {
  /** 폴더 그룹에 속하지 않은 개별 파일·URL */
  readonly ungrouped: ReadonlyArray<FileItem>;
  readonly roots: ReadonlyArray<FileTreeFolder>;
}

interface MutableFolder {
  name: string;
  path: string;
  children: Map<string, MutableFolder>;
  files: Array<FileItem>;
}

function toFolder(node: MutableFolder): FileTreeFolder {
  const folders = [...node.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map(toFolder);
  const totalCount =
    node.files.length + folders.reduce((sum, f) => sum + f.totalCount, 0);
  return {
    name: node.name,
    path: node.path,
    folders,
    files: node.files,
    totalCount,
  };
}

/** flat FileItem 목록을 groupDir 기준의 폴더 트리로 변환한다 */
export function buildFileTree(files: ReadonlyArray<FileItem>): FileTree {
  const ungrouped: Array<FileItem> = [];
  const rootMap = new Map<string, MutableFolder>();

  for (const file of files) {
    if (!file.groupDir) {
      ungrouped.push(file);
      continue;
    }

    const segments = file.groupDir.split("/").filter((s) => s.length > 0);
    let level = rootMap;
    let node: MutableFolder | undefined;
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let next = level.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: currentPath,
          children: new Map(),
          files: [],
        };
        level.set(segment, next);
      }
      node = next;
      level = next.children;
    }
    node?.files.push(file);
  }

  const roots = [...rootMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map(toFolder);
  return { ungrouped, roots };
}

/** 폴더 하위(재귀)의 모든 파일 ID를 수집한다 — 폴더 단위 체크용 */
export function collectFileIds(folder: FileTreeFolder): Array<string> {
  const ids = folder.files.map((f) => f.id);
  for (const child of folder.folders) {
    ids.push(...collectFileIds(child));
  }
  return ids;
}
