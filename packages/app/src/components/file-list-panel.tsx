import {
  CheckCircle2,
  FileText,
  Loader2,
  RotateCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback } from "react";
import { useConvertQueueStore } from "../store/convert-queue-store";
import type { FileItem, FileStatus } from "../store/file-store";
import { isSupportedFile, useFileStore } from "../store/file-store";
import { BatchProgress } from "./batch-progress";
import { OutputDirSelector } from "./output-dir-selector";

const STATUS_ICON: Record<FileStatus, React.ReactNode> = {
  pending: <FileText size={14} className="text-[var(--color-muted)]" />,
  converting: (
    <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
  ),
  done: <CheckCircle2 size={14} className="text-[var(--color-success)]" />,
  error: <XCircle size={14} className="text-[var(--color-error)]" />,
};

const FORMAT_BADGE_COLOR: Record<string, string> = {
  hwpx: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  docx: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pdf: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function FileRow({ file }: { readonly file: FileItem }) {
  const { selectedFileId, selectFile, removeFile } = useFileStore();
  const retry = useConvertQueueStore((s) => s.retry);
  const isSelected = selectedFileId === file.id;

  return (
    <button
      type="button"
      data-testid={`file-row-${file.id}`}
      data-status={file.status}
      className={`flex w-full items-center gap-2 px-3 py-2 cursor-pointer border-b border-[var(--color-border)] transition-colors text-left ${
        isSelected
          ? "bg-[var(--color-accent)]/10"
          : "hover:bg-[var(--color-panel-bg)]"
      }`}
      onClick={() => selectFile(file.id)}
    >
      {STATUS_ICON[file.status]}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{file.name}</p>
        {file.status === "done" && file.result && (
          <p className="text-xs text-[var(--color-muted)]">
            {file.result.elapsed.toFixed(0)}ms
          </p>
        )}
        {file.status === "error" && file.error && (
          <p className="text-xs text-[var(--color-error)] truncate">
            {file.error}
          </p>
        )}
      </div>
      <span
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${FORMAT_BADGE_COLOR[file.format] ?? ""}`}
      >
        {file.format.toUpperCase()}
      </span>
      {file.status === "error" && (
        <button
          type="button"
          className="hover:text-[var(--color-accent)] transition-opacity p-1"
          onClick={(e) => {
            e.stopPropagation();
            retry({ id: file.id, path: file.path });
          }}
          aria-label={`${file.name} 재시도`}
          data-testid={`retry-btn-${file.id}`}
        >
          <RotateCw size={12} />
        </button>
      )}
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] transition-opacity p-1"
        onClick={(e) => {
          e.stopPropagation();
          removeFile(file.id);
        }}
        aria-label={`${file.name} 삭제`}
      >
        <Trash2 size={12} />
      </button>
    </button>
  );
}

export function FileListPanel() {
  const { files, addFiles, clearFiles } = useFileStore();
  const startBatch = useConvertQueueStore((s) => s.startBatch);
  const retry = useConvertQueueStore((s) => s.retry);

  const handleConvertAll = useCallback(() => {
    const pendingFiles = files.filter((f) => f.status === "pending");
    startBatch(pendingFiles.map((f) => ({ id: f.id, path: f.path })));
  }, [files, startBatch]);

  const handleRetryFailed = useCallback(() => {
    const failedFiles = files.filter((f) => f.status === "error");
    for (const file of failedFiles) {
      retry({ id: file.id, path: file.path });
    }
  }, [files, retry]);

  // Tauri 환경에서는 네이티브 drag-drop 이벤트(DropOverlay)를 사용하므로
  // React DOM drop 핸들러를 비활성화하여 중복 등록을 방지합니다.
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isTauri) return;

      const paths: Array<string> = [];
      for (const item of Array.from(e.dataTransfer.files)) {
        if (isSupportedFile(item.name)) {
          paths.push(item.name);
        }
      }
      if (paths.length > 0) {
        addFiles(paths);
      }
    },
    [addFiles, isTauri],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const hasPending = files.some((f) => f.status === "pending");
  const failedCount = files.filter((f) => f.status === "error").length;

  return (
    <section
      className="flex h-full flex-col"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      aria-label="파일 목록"
      data-testid="file-list-panel"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
          파일 ({files.length})
        </span>
        <div className="flex gap-1">
          {hasPending && (
            <button
              type="button"
              onClick={handleConvertAll}
              data-testid="convert-all-btn"
              className="text-xs px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              변환
            </button>
          )}
          {failedCount > 0 && (
            <button
              type="button"
              onClick={handleRetryFailed}
              data-testid="retry-failed-btn"
              className="text-xs px-2 py-1 rounded text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
            >
              실패 {failedCount}개 재시도
            </button>
          )}
          {files.length > 0 && (
            <button
              type="button"
              onClick={clearFiles}
              data-testid="clear-files-btn"
              className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
            >
              초기화
            </button>
          )}
        </div>
      </div>
      <OutputDirSelector />
      <BatchProgress />

      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-2 p-4 text-[var(--color-muted)]"
            data-testid="empty-state"
          >
            <FileText size={32} />
            <p className="text-sm text-center">
              파일을 여기에 드래그하거나
              <br />
              아래 버튼으로 추가하세요
            </p>
            <p className="text-xs">.hwpx, .docx, .pdf</p>
          </div>
        ) : (
          files.map((file) => <FileRow key={file.id} file={file} />)
        )}
      </div>
    </section>
  );
}
