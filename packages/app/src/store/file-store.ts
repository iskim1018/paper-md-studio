import { create } from "zustand";

export type DocumentFormat = "hwpx" | "docx" | "pdf";
export type FileStatus = "pending" | "converting" | "done" | "error";

export interface ConvertResult {
  markdown: string;
  format: DocumentFormat;
  elapsed: number;
  imageCount: number;
}

export interface FileItem {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly status: FileStatus;
  readonly result?: ConvertResult;
  readonly error?: string;
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
}

const FORMAT_EXTENSIONS: Record<string, DocumentFormat> = {
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

    const newFiles: ReadonlyArray<FileItem> = validPaths.map((path) => ({
      id: generateId(),
      path,
      name: getFileName(path),
      format: detectFormat(path),
      status: "pending" as const,
    }));

    set((state) => ({
      files: [...state.files, ...newFiles],
      selectedFileId: state.selectedFileId ?? newFiles[0]?.id ?? null,
    }));
  },

  selectFile: (id) => set({ selectedFileId: id }),

  updateFile: (id, update) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === id ? { ...file, ...update } : file,
      ),
    })),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((file) => file.id !== id),
      selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
    })),

  clearFiles: () => set({ files: [], selectedFileId: null }),
}));

export { isSupportedFile };
