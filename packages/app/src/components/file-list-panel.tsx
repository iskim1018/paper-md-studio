import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus2,
  FolderOpen,
  Link2,
  RotateCw,
  Trash2,
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
import { LogoSymbol } from "./ui/logo-symbol";
import { Tooltip } from "./ui/tooltip";

/** 트리 깊이당 들여쓰기(px) */
const INDENT_PER_DEPTH = 14;
/** 폴더 하위 파일 행의 기본 좌측 패딩(px) — 시안 기준 */
const CHILD_ROW_BASE_PADDING = 24;

/** 상태 점 6px — 기존 lucide 상태 아이콘 대체 (시안: 플랫 미니멀) */
const STATUS_DOT_CLASS: Record<FileStatus, string> = {
  pending: "bg-[var(--color-dot-pending)]",
  converting: "bg-[var(--color-accent)] status-dot-converting",
  done: "bg-[var(--color-success)]",
  error: "bg-[var(--color-error)]",
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
    <div className="flex flex-col gap-1 px-[18px] pb-2">
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
          className="flex-1 min-w-0 rounded-[6px] border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={submit}
          data-testid="url-add-btn"
          className="h-7 rounded-[6px] bg-[var(--color-accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
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

  const paddingLeft =
    depth > 0 ? CHILD_ROW_BASE_PADDING + (depth - 1) * INDENT_PER_DEPTH : 8;

  return (
    // biome-ignore lint/a11y/useSemanticElements: <button>은 interactive children(checkbox, retry/delete buttons)을 포함할 수 없으므로 의도적으로 <div role="button"> 사용
    <div
      role="button"
      tabIndex={0}
      data-testid={`file-row-${file.id}`}
      data-status={file.status}
      data-checked={isChecked ? "true" : "false"}
      className={`group/row flex w-full items-center gap-2 rounded-[6px] py-[7px] pr-2 cursor-pointer transition-colors text-left ${
        isChecked || isSelected
          ? "bg-[var(--color-row-selected)]"
          : "hover:bg-[var(--color-row-hover)]"
      }`}
      style={{ paddingLeft }}
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
        className={`cursor-pointer transition-opacity ${
          isChecked
            ? "opacity-100"
            : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        }`}
      />
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[file.status]}`}
        data-testid={`status-dot-${file.id}`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p
          className={`truncate text-[12.5px] ${
            isChecked || isSelected
              ? "text-[var(--color-text)]"
              : "text-[var(--color-text-secondary)]"
          }`}
        >
          {file.name}
        </p>
        {file.status === "error" && file.error && (
          <p className="truncate text-[11px] text-[var(--color-error)]">
            {file.error}
          </p>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-faint)]">
        {file.format}
      </span>
      {file.status === "error" && (
        <button
          type="button"
          className="p-1 opacity-0 group-hover/row:opacity-100 hover:text-[var(--color-accent)] transition-opacity"
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
        className="p-1 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-error)] transition-opacity"
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
        className="group/folder flex w-full items-center gap-[7px] rounded-[6px] py-1.5 pr-2 hover:bg-[var(--color-row-hover)] transition-colors"
        style={{ paddingLeft: 8 + depth * INDENT_PER_DEPTH }}
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
          className={`cursor-pointer transition-opacity ${
            allChecked || someChecked
              ? "opacity-100"
              : "opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100"
          }`}
        />
        <button
          type="button"
          onClick={() => onToggleCollapse(folder.path)}
          aria-label={`${folder.name} ${isCollapsed ? "펼치기" : "접기"}`}
          aria-expanded={!isCollapsed}
          data-testid={`folder-toggle-${folder.path}`}
          className="flex flex-1 min-w-0 items-center gap-[7px] text-left cursor-pointer text-[var(--color-text)] transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight
              size={13}
              className="shrink-0 text-[var(--color-muted)]"
            />
          ) : (
            <ChevronDown
              size={13}
              className="shrink-0 text-[var(--color-muted)]"
            />
          )}
          <span className="flex-1 truncate text-[12.5px] font-semibold">
            {folder.name}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--color-faint)]">
            {checkedCount > 0 ? `${checkedCount}/` : ""}
            {folder.totalCount}
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

/** 첫 실행 빈 상태 — 드롭존 카드 + 추가 방법 링크 (시안 2a-빈상태) */
function EmptyState({
  onOpenFiles,
  onOpenFolder,
  onOpenUrl,
}: {
  readonly onOpenFiles: () => void;
  readonly onOpenFolder: () => void;
  readonly onOpenUrl: () => void;
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3.5 p-6"
      data-testid="empty-state"
    >
      <div className="flex w-[190px] flex-col items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-[var(--color-table-header-border)] px-[18px] py-[22px]">
        <LogoSymbol size={40} className="opacity-90" />
        <p className="text-center text-[13px] leading-normal text-[var(--color-text-secondary)]">
          문서를 여기에
          <br />
          드래그 앤 드롭
        </p>
        <p className="text-center font-mono text-[11px] text-[var(--color-faint)]">
          hwp hwpx docx pdf html md
        </p>
      </div>
      <span className="text-xs text-[var(--color-muted)]">
        또는{" "}
        <button
          type="button"
          onClick={onOpenFiles}
          className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          data-testid="empty-open-files-btn"
        >
          파일 선택
        </button>
        {" · "}
        <button
          type="button"
          onClick={onOpenFolder}
          className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          data-testid="empty-open-folder-btn"
        >
          폴더
        </button>
        {" · "}
        <button
          type="button"
          onClick={onOpenUrl}
          className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          data-testid="empty-url-btn"
        >
          URL
        </button>
      </span>
    </div>
  );
}

/** 섹션 라벨 우측의 아이콘 전용 추가 버튼 */
function IconButton({
  label,
  testId,
  active,
  onClick,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly active?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        aria-label={label}
        className={`rounded-[6px] p-[5px] transition-colors ${
          active
            ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
            : "text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)]"
        }`}
      >
        {children}
      </button>
    </Tooltip>
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
  const showActionRow = hasPending || failedCount > 0 || files.length > 0;

  return (
    <section
      className="flex h-full flex-col"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      aria-label="파일 목록"
      data-testid="file-list-panel"
    >
      {/* 섹션 라벨 행 */}
      <div className="flex shrink-0 items-center justify-between px-[18px] pt-3.5 pb-1.5">
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
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
            파일 · {files.length}
            {checkedCount > 0 && (
              <span className="text-[var(--color-accent)]">
                {" "}
                선택 {checkedCount}
              </span>
            )}
          </span>
        </div>
        <div className="flex gap-0.5">
          {allFolderPaths.length > 0 && (
            <IconButton
              label={allExpanded ? "폴더 전체 접기" : "폴더 전체 펼치기"}
              testId="expand-all-btn"
              onClick={handleToggleExpandAll}
            >
              {allExpanded ? (
                <ChevronsDownUp size={14} />
              ) : (
                <ChevronsUpDown size={14} />
              )}
            </IconButton>
          )}
          <IconButton
            label="파일 탐색기에서 문서 선택"
            testId="open-files-btn"
            onClick={openFiles}
          >
            <FilePlus2 size={14} />
          </IconButton>
          <IconButton
            label="폴더를 선택해 하위 문서를 트리로 추가"
            testId="open-folder-btn"
            onClick={openFolder}
          >
            <FolderOpen size={14} />
          </IconButton>
          <IconButton
            label="웹 페이지 URL을 Markdown으로 변환"
            testId="url-toggle-btn"
            active={showUrlInput}
            onClick={() => setShowUrlInput((v) => !v)}
          >
            <Link2 size={14} />
          </IconButton>
        </div>
      </div>

      {/* 액션 행 — 변환/재시도/초기화 */}
      {showActionRow && (
        <div className="flex shrink-0 items-center gap-2 px-[18px] pt-1.5 pb-2.5">
          {hasPending && (
            <button
              type="button"
              onClick={handleConvert}
              data-testid="convert-all-btn"
              className="flex h-7 items-center gap-1.5 rounded-[6px] bg-[var(--color-accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              {checkedCount > 0 ? `선택 ${checkedCount}개 변환` : "변환"}
            </button>
          )}
          {failedCount > 0 && (
            <button
              type="button"
              onClick={handleRetryFailed}
              data-testid="retry-failed-btn"
              className="text-xs text-[var(--color-error)] hover:underline transition-colors"
            >
              실패 {failedCount}개 재시도
            </button>
          )}
          {files.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              data-testid="clear-files-btn"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
            >
              초기화
            </button>
          )}
        </div>
      )}

      {showUrlInput && <UrlInputForm onClose={() => setShowUrlInput(false)} />}
      <BatchProgress />
      <div className="shrink-0 border-b border-[var(--color-border)]" />

      <div className="flex-1 overflow-y-auto px-2.5 py-1.5">
        {files.length === 0 ? (
          <EmptyState
            onOpenFiles={openFiles}
            onOpenFolder={openFolder}
            onOpenUrl={() => setShowUrlInput(true)}
          />
        ) : (
          <FileTreeList
            tree={tree}
            expandedDirs={expandedDirs}
            onToggleCollapse={handleToggleCollapse}
          />
        )}
      </div>

      <OutputDirSelector />
    </section>
  );
}
