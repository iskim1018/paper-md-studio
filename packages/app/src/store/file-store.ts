import { create } from "zustand";

export type DocumentFormat = "hwp" | "hwpx" | "docx" | "pdf";
export type FileStatus = "pending" | "converting" | "done" | "error";

export interface ConvertResult {
  markdown: string;
  format: DocumentFormat;
  elapsed: number;
  imageCount: number;
  outputPath: string;
}

export interface FileItem {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly status: FileStatus;
  readonly result?: ConvertResult;
  readonly error?: string;
  /** 편집 중인 Markdown 문자열. 변환 완료 시 result.markdown으로 초기화된다. */
  readonly editedMarkdown: string | null;
  /** editedMarkdown이 원본 result.markdown과 다르면 true. */
  readonly isDirty: boolean;
  /** 정리 버튼 등 일괄 변환 직전의 스냅샷 (1-step undo용). 없으면 null. */
  readonly cleanupSnapshot: string | null;
}

interface FileStore {
  readonly files: ReadonlyArray<FileItem>;
  readonly selectedFileId: string | null;
  addFiles: (paths: ReadonlyArray<string>) => void;
  selectFile: (id: string | null) => void;
  updateFile: (
    id: string,
    update: Partial<Pick<FileItem, "status" | "result" | "error">>,
  ) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  /** 편집 중인 Markdown 내용을 갱신한다. 원본과 같으면 dirty가 해제된다. */
  setEditedMarkdown: (id: string, markdown: string) => void;
  /** 저장 완료 처리 — 편집 내용은 유지하고 dirty만 해제한다. */
  markSaved: (id: string) => void;
  /** 편집 내용을 원본 result.markdown으로 되돌린다. */
  discardEdits: (id: string) => void;
  /** 편집 내용에 변환 함수를 적용하고 직전 상태를 cleanupSnapshot에 저장한다. */
  applyCleanup: (id: string, transform: (md: string) => string) => void;
  /** applyCleanup을 되돌린다. */
  undoCleanup: (id: string) => void;
}

const FORMAT_EXTENSIONS: Record<string, DocumentFormat> = {
  ".hwp": "hwp",
  ".hwpx": "hwpx",
  ".docx": "docx",
  ".pdf": "pdf",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(FORMAT_EXTENSIONS));

function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function getFileName(path: string): string {
  const sep = path.lastIndexOf("/");
  return sep === -1 ? path : path.slice(sep + 1);
}

function isSupportedFile(path: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getExtension(path));
}

function detectFormat(path: string): DocumentFormat {
  const ext = getExtension(path);
  const format = FORMAT_EXTENSIONS[ext];
  if (!format) {
    throw new Error(`지원하지 않는 파일 형식: ${ext}`);
  }
  return format;
}

let nextId = 0;
function generateId(): string {
  nextId += 1;
  return `file-${nextId}-${Date.now()}`;
}

export const useFileStore = create<FileStore>((set) => ({
  files: [],
  selectedFileId: null,

  addFiles: (paths) => {
    const validPaths = paths.filter(isSupportedFile);
    if (validPaths.length === 0) return;

    set((state) => {
      const existingPaths = new Set(state.files.map((f) => f.path));
      const uniquePaths = validPaths.filter((p) => {
        if (existingPaths.has(p)) return false;
        existingPaths.add(p);
        return true;
      });

      if (uniquePaths.length === 0) return state;

      const newFiles: ReadonlyArray<FileItem> = uniquePaths.map((path) => ({
        id: generateId(),
        path,
        name: getFileName(path),
        format: detectFormat(path),
        status: "pending" as const,
        editedMarkdown: null,
        isDirty: false,
        cleanupSnapshot: null,
      }));

      return {
        files: [...state.files, ...newFiles],
        selectedFileId: state.selectedFileId ?? newFiles[0]?.id ?? null,
      };
    });
  },

  selectFile: (id) => set({ selectedFileId: id }),

  updateFile: (id, update) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== id) return file;
        // 변환 완료(result 수신) 시 editedMarkdown을 원본으로 초기화하고
        // dirty 플래그를 해제한다.
        if (update.result !== undefined) {
          return {
            ...file,
            ...update,
            editedMarkdown: update.result.markdown,
            isDirty: false,
            cleanupSnapshot: null,
          };
        }
        return { ...file, ...update };
      }),
    })),

  setEditedMarkdown: (id, markdown) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== id) return file;
        const originalMarkdown = file.result?.markdown ?? null;
        return {
          ...file,
          editedMarkdown: markdown,
          isDirty: originalMarkdown !== null && markdown !== originalMarkdown,
          // 사용자가 직접 편집하면 이전 cleanup undo 스냅샷은 무효화
          cleanupSnapshot: null,
        };
      }),
    })),

  markSaved: (id) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === id ? { ...file, isDirty: false } : file,
      ),
    })),

  discardEdits: (id) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== id) return file;
        const originalMarkdown = file.result?.markdown ?? null;
        return {
          ...file,
          editedMarkdown: originalMarkdown,
          isDirty: false,
          cleanupSnapshot: null,
        };
      }),
    })),

  applyCleanup: (id, transform) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== id) return file;
        const current = file.editedMarkdown ?? file.result?.markdown ?? "";
        const next = transform(current);
        if (next === current) return file;
        const originalMarkdown = file.result?.markdown ?? null;
        return {
          ...file,
          editedMarkdown: next,
          isDirty: originalMarkdown !== null && next !== originalMarkdown,
          cleanupSnapshot: current,
        };
      }),
    })),

  undoCleanup: (id) =>
    set((state) => ({
      files: state.files.map((file) => {
        if (file.id !== id || file.cleanupSnapshot === null) return file;
        const originalMarkdown = file.result?.markdown ?? null;
        const restored = file.cleanupSnapshot;
        return {
          ...file,
          editedMarkdown: restored,
          isDirty: originalMarkdown !== null && restored !== originalMarkdown,
          cleanupSnapshot: null,
        };
      }),
    })),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((file) => file.id !== id),
      selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
    })),

  clearFiles: () => set({ files: [], selectedFileId: null }),
}));

export { isSupportedFile };
