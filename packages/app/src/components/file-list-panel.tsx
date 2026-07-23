import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus2,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  RotateCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useFilePickers } from "../hooks/use-file-pickers";
import type { FileTreeFolder } from "../lib/file-tree";
import {
  buildFileTree,
  collectFileIds,
  collectFolderPaths,
} from "../lib/file-tree";
import { useConvertQueueStore } from "../store/convert-queue-store";
import type { FileItem, FileStatus } from "../store/file-store";
import { isSupportedFile, useFileStore } from "../store/file-store";
import { BatchProgress } from "./batch-progress";
import { OutputDirSelector } from "./output-dir-selector";

/** 트리 깊이당 들여쓰기(px) */
const INDENT_PER_DEPTH = 14;
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
  doc: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  docx: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pdf: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  html: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

/** URL 입력 인라인 폼 — Enter 또는 추가 버튼으로 확정 */
function UrlInputForm({ onClose }: { readonly onClose: () => void }) {
  const addUrl = useFileStore((s) => s.addUrl);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = useCallback(() => {
    const ok = addUrl(value);
    if (ok) {
      setValue("");
      setInvalid(false);
      onClose();
    } else {
      setInvalid(true);
    }
  }, [addUrl, value, onClose]);

  return (
    <div className="flex flex-col gap-1 border-b border-[var(--color-border)] px-3 py-2">
      <div className="flex items-center gap-1">
        <input
          type="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="https://example.com/page"
          aria-label="변환할 URL"
          data-testid="url-input"
          // biome-ignore lint/a11y/noAutofocus: 폼을 연 직후 바로 입력하는 UX 의도
          autoFocus
          className="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={submit}
          data-testid="url-add-btn"
          className="text-xs px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          추가
        </button>
      </div>
      {invalid && (
        <p className="text-xs text-[var(--color-error)]">
          http(s) URL 형식이 아니거나 이미 추가된 URL입니다.
        </p>
      )}
    </div>
  );
}

function FileRow({
  file,
  depth = 0,
}: {
  readonly file: FileItem;
  readonly depth?: number;
}) {
  const selectedFileId = useFileStore((s) => s.selectedFileId);
  const selectFile = useFileStore((s) => s.selectFile);
  const removeFile = useFileStore((s) => s.removeFile);
  const checkedIds = useFileStore((s) => s.checkedIds);
  const toggleCheck = useFileStore((s) => s.toggleCheck);
  const setCheckedOnly = useFileStore((s) => s.setCheckedOnly);
  const checkRange = useFileStore((s) => s.checkRange);
  const retry = useConvertQueueStore((s) => s.retry);
  const isSelected = selectedFileId === file.id;
  const isChecked = checkedIds.has(file.id);

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      checkRange(file.id);
    } else if (e.metaKey || e.ctrlKey) {
      toggleCheck(file.id);
    } else {
      setCheckedOnly(file.id);
      selectFile(file.id);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <button>은 interactive children(checkbox, retry/delete buttons)을 포함할 수 없으므로 의도적으로 <div role="button"> 사용
    <div
      role="button"
      tabIndex={0}
      data-testid={`file-row-${file.id}`}
      data-status={file.status}
      data-checked={isChecked ? "true" : "false"}
      className={`flex w-full items-center gap-2 px-3 py-2 cursor-pointer border-b border-[var(--color-border)] transition-colors text-left ${
        isChecked
          ? "bg-[var(--color-accent)]/15"
          : isSelected
            ? "bg-[var(--color-accent)]/10"
            : "hover:bg-[var(--color-panel-bg)]"
      }`}
      style={
        depth > 0 ? { paddingLeft: 12 + depth * INDENT_PER_DEPTH } : undefined
      }
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleRowClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      <input
        type="checkbox"
        checked={isChecked}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggleCheck(file.id)}
        aria-label={`${file.name} 선택`}
        data-testid={`check-${file.id}`}
        className="cursor-pointer"
      />
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
    </div>
  );
}

/** 폴더 트리 노드 — 접기/펼치기 + 폴더 단위 일괄 체크 */
function FolderNode({
  folder,
  depth,
  expandedDirs,
  onToggleCollapse,
}: {
  readonly folder: FileTreeFolder;
  readonly depth: number;
  readonly expandedDirs: ReadonlySet<string>;
  readonly onToggleCollapse: (path: string) => void;
}) {
  const checkedIds = useFileStore((s) => s.checkedIds);
  const setCheckedMany = useFileStore((s) => s.setCheckedMany);

  const descendantIds = useMemo(() => collectFileIds(folder), [folder]);
  const checkedCount = descendantIds.filter((id) => checkedIds.has(id)).length;
  const allChecked =
    descendantIds.length > 0 && checkedCount === descendantIds.length;
  const someChecked = checkedCount > 0 && !allChecked;
  const isCollapsed = !expandedDirs.has(folder.path);

  return (
    <div data-testid={`folder-node-${folder.path}`}>
      <div
        className="flex w-full items-center gap-1.5 py-1.5 pr-3 border-b border-[var(--color-border)] bg-[var(--color-panel-bg)]/50"
        style={{ paddingLeft: 12 + depth * INDENT_PER_DEPTH }}
      >
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          onChange={() => setCheckedMany(descendantIds, !allChecked)}
          aria-label={`${folder.name} 폴더 전체 선택`}
          data-testid={`folder-check-${folder.path}`}
          className="cursor-pointer"
        />
        <button
          type="button"
          onClick={() => onToggleCollapse(folder.path)}
          aria-label={`${folder.name} ${isCollapsed ? "펼치기" : "접기"}`}
          aria-expanded={!isCollapsed}
          data-testid={`folder-toggle-${folder.path}`}
          className="flex flex-1 min-w-0 items-center gap-1 text-left cursor-pointer hover:text-[var(--color-accent)] transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight size={14} className="shrink-0" />
          ) : (
            <ChevronDown size={14} className="shrink-0" />
          )}
          <FolderOpen
            size={14}
            className="shrink-0 text-[var(--color-accent)]"
          />
          <span className="text-sm font-medium truncate">{folder.name}</span>
          <span className="text-xs text-[var(--color-muted)] shrink-0">
            ({checkedCount > 0 ? `${checkedCount}/` : ""}
            {folder.totalCount})
          </span>
        </button>
      </div>
      {!isCollapsed && (
        <>
          {folder.folders.map((child) => (
            <FolderNode
              key={child.path}
              folder={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
          {folder.files.map((file) => (
            <FileRow key={file.id} file={file} depth={depth + 1} />
          ))}
        </>
      )}
    </div>
  );
}

/** 헤더의 전체 선택 체크박스 상태·토글 */
function useSelectAllCheckbox(fileCount: number) {
  const checkedIds = useFileStore((s) => s.checkedIds);
  const checkAll = useFileStore((s) => s.checkAll);
  const clearChecked = useFileStore((s) => s.clearChecked);

  const checkedCount = checkedIds.size;
  const allChecked = fileCount > 0 && checkedCount === fileCount;
  const someChecked = checkedCount > 0 && checkedCount < fileCount;
  const toggle = useCallback(() => {
    if (allChecked) {
      clearChecked();
    } else {
      checkAll();
    }
  }, [allChecked, checkAll, clearChecked]);

  return { allChecked, someChecked, toggle };
}

/**
 * 브라우저(DOM) drag-drop 핸들러.
 * Tauri 환경에서는 네이티브 drag-drop 이벤트(DropOverlay)를 사용하므로
 * DOM drop을 비활성화하여 중복 등록을 방지한다.
 */
function useDomDropHandlers(addFiles: (paths: ReadonlyArray<string>) => void) {
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

  return { handleDrop, handleDragOver };
}

/** 개별 파일(평면) + 폴더 트리 목록 본문 */
function FileTreeList({
  tree,
  expandedDirs,
  onToggleCollapse,
}: {
  readonly tree: ReturnType<typeof buildFileTree>;
  readonly expandedDirs: ReadonlySet<string>;
  readonly onToggleCollapse: (path: string) => void;
}) {
  return (
    <>
      {tree.ungrouped.map((file) => (
        <FileRow key={file.id} file={file} />
      ))}
      {tree.roots.map((folder) => (
        <FolderNode
          key={folder.path}
          folder={folder}
          depth={0}
          expandedDirs={expandedDirs}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </>
  );
}

export function FileListPanel() {
  const { files, addFiles, clearFiles } = useFileStore();
  const checkedIds = useFileStore((s) => s.checkedIds);
  const startBatch = useConvertQueueStore((s) => s.startBatch);
  const retry = useConvertQueueStore((s) => s.retry);
  const resetQueue = useConvertQueueStore((s) => s.reset);

  const { openFiles, openFolder } = useFilePickers();
  const [showUrlInput, setShowUrlInput] = useState(false);
  // 기본은 전부 접힘 — 펼친 폴더만 기록한다
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const tree = useMemo(() => buildFileTree(files), [files]);
  const allFolderPaths = useMemo(
    () => collectFolderPaths(tree.roots),
    [tree.roots],
  );
  const allExpanded =
    allFolderPaths.length > 0 &&
    allFolderPaths.every((path) => expandedDirs.has(path));

  const handleToggleCollapse = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleToggleExpandAll = useCallback(() => {
    setExpandedDirs(allExpanded ? new Set() : new Set(allFolderPaths));
  }, [allExpanded, allFolderPaths]);

  const handleClear = useCallback(() => {
    resetQueue();
    clearFiles();
  }, [resetQueue, clearFiles]);

  const checkedCount = checkedIds.size;

  const handleConvert = useCallback(() => {
    // 체크된 항목이 있으면 그것만, 없으면 모든 pending 일괄
    const target =
      checkedCount > 0
        ? files.filter((f) => checkedIds.has(f.id) && f.status === "pending")
        : files.filter((f) => f.status === "pending");
    startBatch(target.map((f) => ({ id: f.id, path: f.path })));
  }, [files, checkedIds, checkedCount, startBatch]);

  const handleRetryFailed = useCallback(() => {
    const failedFiles = files.filter((f) => f.status === "error");
    for (const file of failedFiles) {
      retry({ id: file.id, path: file.path });
    }
  }, [files, retry]);

  const {
    allChecked,
    someChecked,
    toggle: handleHeaderCheckChange,
  } = useSelectAllCheckbox(files.length);

  const { handleDrop, handleDragOver } = useDomDropHandlers(addFiles);

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
        <div className="flex items-center gap-2">
          {files.length > 0 && (
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              onChange={handleHeaderCheckChange}
              aria-label="전체 선택"
              data-testid="check-all"
              className="cursor-pointer"
            />
          )}
          <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
            파일 ({files.length}
            {checkedCount > 0 && ` · 선택 ${checkedCount}`})
          </span>
        </div>
        <div className="flex gap-1">
          {allFolderPaths.length > 0 && (
            <button
              type="button"
              onClick={handleToggleExpandAll}
              data-testid="expand-all-btn"
              aria-label={allExpanded ? "전체 접기" : "전체 펼치기"}
              title={allExpanded ? "폴더 전체 접기" : "폴더 전체 펼치기"}
              className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              {allExpanded ? (
                <ChevronsDownUp size={14} />
              ) : (
                <ChevronsUpDown size={14} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={openFiles}
            data-testid="open-files-btn"
            aria-label="파일 열기"
            title="파일 탐색기에서 문서 선택"
            className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            onClick={openFolder}
            data-testid="open-folder-btn"
            aria-label="폴더 열기"
            title="폴더를 선택해 하위 문서를 트리로 추가"
            className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            onClick={() => setShowUrlInput((v) => !v)}
            data-testid="url-toggle-btn"
            aria-label="URL 추가"
            title="웹 페이지 URL을 Markdown으로 변환"
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showUrlInput
                ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            }`}
          >
            <Link2 size={14} />
          </button>
          {hasPending && (
            <button
              type="button"
              onClick={handleConvert}
              data-testid="convert-all-btn"
              className="text-xs px-2 py-1 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              {checkedCount > 0 ? `선택 ${checkedCount}개 변환` : "변환"}
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
              onClick={handleClear}
              data-testid="clear-files-btn"
              className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
            >
              초기화
            </button>
          )}
        </div>
      </div>
      {showUrlInput && <UrlInputForm onClose={() => setShowUrlInput(false)} />}
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
              상단 버튼(파일·폴더·URL)으로 추가하세요
            </p>
            <p className="text-xs">.hwp, .hwpx, .docx, .pdf, .html, .md</p>
          </div>
        ) : (
          <FileTreeList
            tree={tree}
            expandedDirs={expandedDirs}
            onToggleCollapse={handleToggleCollapse}
          />
        )}
      </div>
    </section>
  );
}
