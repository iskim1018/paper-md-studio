import {
  Check,
  Copy,
  Eraser,
  Eye,
  FileCode2,
  FolderOpen,
  Save,
  SaveAll,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { useSaveShortcut } from "../hooks/use-save-shortcut";
import { saveMarkdownAs, saveMarkdownTo } from "../lib/file-writer";
import { removeEmptyTableRows } from "../lib/md-cleanup";
import { fileManagerName, revealFile } from "../lib/reveal";
import { shortcutLabel } from "../lib/shortcuts";
import { useConvertQueueStore } from "../store/convert-queue-store";
import type { FileItem } from "../store/file-store";
import { useFileStore } from "../store/file-store";
import { MarkdownPreview } from "./editor/markdown-preview";
import { MilkdownEditor } from "./editor/milkdown-editor";
import { SourceEditor } from "./editor/source-editor";
import { ResizeHandle } from "./ui/resize-handle";
import { Tooltip } from "./ui/tooltip";

type ViewMode = "preview" | "edit" | "source" | "split";

interface ConversionNoticeProps {
  readonly file: FileItem;
}

/**
 * 변환은 성공했지만 결과가 기대와 다를 수 있을 때 그 이유를 알립니다.
 *
 * 텍스트 레이어가 없는 스캔 PDF 처럼 "성공했는데 내용이 비어 있는" 경우,
 * 알림이 없으면 사용자는 앱이 고장 난 것으로 오해한다.
 *
 * 엑셀의 숨김 항목은 여기서 곧바로 되돌릴 수 있게 한다. 무엇이 숨겨져 있는지는
 * 파일을 열어보기 전엔 알 수 없어 변환 전에 묻는 것은 깜깜이 선택을 강요하는
 * 셈이다. 반면 이 시점엔 무엇이 몇 개 빠졌는지 이미 알고 있다. 숨긴 게 없는
 * 파일에서는 배너가 뜨지 않아 평소 UI 비용은 0이다.
 */
function ConversionNotice({ file }: ConversionNoticeProps) {
  const setIncludeHidden = useFileStore((s) => s.setIncludeHidden);
  const retry = useConvertQueueStore((s) => s.retry);

  const warnings = file.result?.warnings ?? [];
  const hasExcluded = file.result?.hiddenExcluded !== undefined;
  // 포함 상태에서는 제외된 게 없으니, 되돌릴 근거는 사용자의 선택 자체다
  const canToggleHidden = hasExcluded || file.includeHidden;
  const isConverting = file.status === "converting";

  const handleToggleHidden = useCallback(() => {
    setIncludeHidden(file.id, !file.includeHidden);
    retry({ id: file.id, path: file.path });
  }, [file.id, file.path, file.includeHidden, setIncludeHidden, retry]);

  if (warnings.length === 0 && !canToggleHidden) {
    return null;
  }

  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b border-[var(--color-border)] bg-[var(--color-chip-bg)] px-[18px] py-2 text-xs text-[var(--color-muted)]"
      data-testid="conversion-warnings"
      role="status"
    >
      {file.includeHidden ? (
        <Eye size={14} className="mt-px shrink-0 text-[var(--color-accent)]" />
      ) : (
        <TriangleAlert
          size={14}
          className="mt-px shrink-0 text-[var(--color-accent)]"
        />
      )}

      <ul className="space-y-1">
        {file.includeHidden && <li>숨긴 시트·행·열을 포함해 변환했습니다.</li>}
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>

      {canToggleHidden && (
        <button
          type="button"
          onClick={handleToggleHidden}
          disabled={isConverting}
          className="ml-auto shrink-0 cursor-pointer rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-hover)] disabled:cursor-default disabled:opacity-50"
          data-testid="toggle-hidden-btn"
        >
          {isConverting
            ? "다시 변환 중..."
            : file.includeHidden
              ? "숨긴 항목 빼고 다시 변환"
              : "숨긴 항목 포함해 다시 변환"}
        </button>
      )}
    </div>
  );
}

export function ResultPanel() {
  const { files, selectedFileId } = useFileStore();
  const setEditedMarkdown = useFileStore((s) => s.setEditedMarkdown);
  const markSaved = useFileStore((s) => s.markSaved);
  const applyCleanup = useFileStore((s) => s.applyCleanup);
  const undoCleanup = useFileStore((s) => s.undoCleanup);
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<ViewMode>("preview");
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayedMarkdown =
    selectedFile?.editedMarkdown ?? selectedFile?.result?.markdown ?? "";

  const handleCopy = useCallback(async () => {
    if (!displayedMarkdown) return;
    await navigator.clipboard.writeText(displayedMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayedMarkdown]);

  const handleOpenFolder = useCallback(async () => {
    const outputPath = selectedFile?.result?.outputPath;
    if (!outputPath) return;
    try {
      await revealFile(outputPath);
    } catch (err: unknown) {
      // 조용히 삼키면 "눌러도 아무 일 없는" 버튼이 된다 (이전 구현의 문제)
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      setSaveError(`폴더를 열 수 없습니다 — ${message}`);
    }
  }, [selectedFile]);

  const handleEdit = useCallback(
    (markdown: string) => {
      if (!selectedFile) return;
      setEditedMarkdown(selectedFile.id, markdown);
    },
    [selectedFile, setEditedMarkdown],
  );

  const handleSave = useCallback(async () => {
    if (!selectedFile?.result?.outputPath || !selectedFile.isDirty) return;
    try {
      await saveMarkdownTo(selectedFile.result.outputPath, displayedMarkdown);
      markSaved(selectedFile.id);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장 실패");
    }
  }, [selectedFile, displayedMarkdown, markSaved]);

  const handleSaveAs = useCallback(async () => {
    if (!selectedFile?.result?.outputPath) return;
    try {
      const saved = await saveMarkdownAs(
        selectedFile.result.outputPath,
        displayedMarkdown,
      );
      if (saved !== null) {
        markSaved(selectedFile.id);
        setSaveError(null);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장 실패");
    }
  }, [selectedFile, displayedMarkdown, markSaved]);

  useSaveShortcut({
    enabled: selectedFile?.status === "done",
    onSave: handleSave,
    onSaveAs: handleSaveAs,
  });

  const handleRemoveEmptyRows = useCallback(() => {
    if (!selectedFile) return;
    applyCleanup(selectedFile.id, removeEmptyTableRows);
  }, [selectedFile, applyCleanup]);

  const handleUndoCleanup = useCallback(() => {
    if (!selectedFile) return;
    undoCleanup(selectedFile.id);
  }, [selectedFile, undoCleanup]);

  // 재변환(숨김 포함/제외 전환) 중에는 직전 결과를 그대로 두고 배너만 바뀐다.
  // 상태만 보고 비우면 버튼을 누르는 순간 보던 내용이 사라졌다 돌아와 깜빡인다.
  if (!selectedFile?.result) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]"
        data-testid="result-empty"
      >
        <FileCode2
          size={28}
          strokeWidth={1.5}
          className="text-[var(--color-dot-pending)]"
        />
        <p className="text-[13px]">변환 결과 Markdown이 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="result-panel">
      <ConversionNotice file={selectedFile} />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-y-1 border-b border-[var(--color-border)] px-[18px] py-2.5">
        <ModeToggle mode={mode} onChange={setMode} />
        <div className="flex flex-wrap items-center gap-0.5">
          <Tooltip content="편집 내용 저장" shortcut={shortcutLabel("save")}>
            <button
              type="button"
              onClick={handleSave}
              disabled={!selectedFile.isDirty}
              className={`flex items-center rounded-[6px] p-1.5 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                selectedFile.isDirty
                  ? "text-[var(--color-accent)] hover:bg-[var(--color-chip-bg)]"
                  : "text-[var(--color-muted)]"
              }`}
              aria-label="저장"
              data-testid="save-btn"
            >
              <Save size={14} />
            </button>
          </Tooltip>
          <Tooltip
            content="다른 이름으로 저장"
            shortcut={shortcutLabel("save-as")}
          >
            <button
              type="button"
              onClick={handleSaveAs}
              className="flex items-center rounded-[6px] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)] transition-colors"
              aria-label="다른 이름으로 저장"
              data-testid="save-as-btn"
            >
              <SaveAll size={14} />
            </button>
          </Tooltip>
          <Tooltip content="표에서 내용이 빈 행을 일괄 제거">
            <button
              type="button"
              onClick={handleRemoveEmptyRows}
              className="flex items-center rounded-[6px] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)] transition-colors"
              aria-label="빈 행 정리"
              data-testid="remove-empty-rows-btn"
            >
              <Eraser size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Markdown 전체를 클립보드에 복사">
            <button
              type="button"
              onClick={handleCopy}
              className={`flex items-center rounded-[6px] p-1.5 transition-colors ${
                copied
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)]"
              }`}
              aria-label={copied ? "복사됨" : "복사"}
              data-testid="copy-btn"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </Tooltip>
          <Tooltip content={`${fileManagerName()}에서 결과 파일 보기`}>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex items-center rounded-[6px] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-chip-bg)] hover:text-[var(--color-text)] transition-colors"
              aria-label="폴더 열기"
              data-testid="open-folder-btn"
            >
              <FolderOpen size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      {saveError && (
        <div
          className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-error)]/10 px-[18px] py-1.5 text-xs text-[var(--color-error)]"
          data-testid="save-error"
        >
          저장 오류: {saveError}
        </div>
      )}
      {selectedFile.cleanupSnapshot !== null && (
        <div
          className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-accent)]/8 px-[18px] py-1.5 text-xs"
          data-testid="cleanup-banner"
        >
          <span className="text-[var(--color-muted)]">
            일괄 정리를 적용했습니다.
          </span>
          <button
            type="button"
            onClick={handleUndoCleanup}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[var(--color-accent)] hover:underline"
            data-testid="undo-cleanup-btn"
          >
            <Undo2 size={11} />
            정리 취소
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "preview" && (
          <MarkdownPreview
            markdown={displayedMarkdown}
            basePath={selectedFile.result.outputPath}
          />
        )}
        {mode === "edit" && (
          <MilkdownEditor
            // 파일이 바뀌면 에디터를 재마운트하여 초기값을 반영
            key={`milk-${selectedFile.id}`}
            initialValue={displayedMarkdown}
            onChange={handleEdit}
          />
        )}
        {mode === "source" && (
          <SourceEditor
            // 파일 단위로만 재마운트. mode 전환 시에는 컴포넌트 자체가
            // unmount/remount되므로 WYSIWYG → source 전환 시 최신값이
            // 자연히 initialValue로 반영된다. length를 key에 포함하면
            // 매 키 입력마다 재마운트되어 CodeMirror history가 초기화되고
            // 입력 도중 일부 키가 누락되는 버그가 발생한다.
            key={`src-${selectedFile.id}`}
            initialValue={displayedMarkdown}
            onChange={handleEdit}
          />
        )}
        {mode === "split" && (
          <PanelGroup
            direction="horizontal"
            className="h-full"
            data-testid="split-view"
          >
            <Panel defaultSize={50} minSize={20}>
              <SourceEditor
                // length를 key에 포함하지 않는다 (위 source 모드 주석 참조)
                key={`split-src-${selectedFile.id}`}
                initialValue={displayedMarkdown}
                onChange={handleEdit}
              />
            </Panel>
            <ResizeHandle />
            <Panel defaultSize={50} minSize={20}>
              <div
                className="h-full border-l border-[var(--color-border)]"
                data-testid="split-preview"
              >
                <MarkdownPreview
                  markdown={displayedMarkdown}
                  basePath={selectedFile.result.outputPath}
                />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--color-border)] px-[18px] py-[9px] text-[11.5px] text-[var(--color-muted)]">
        {selectedFile.isDirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
            title="저장되지 않은 편집 있음"
            data-testid="dirty-indicator"
            aria-hidden
          />
        )}
        <p
          className="flex-1 truncate"
          title={selectedFile.result.outputPath}
          data-testid="output-path"
        >
          {selectedFile.isDirty ? "저장되지 않음 · " : "저장: "}
          {selectedFile.result.outputPath}
        </p>
        <button
          type="button"
          onClick={handleOpenFolder}
          className="shrink-0 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          data-testid="footer-open-folder-btn"
        >
          폴더 열기
        </button>
      </div>
    </div>
  );
}

interface ModeToggleProps {
  readonly mode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
}

/** 모드 전환 필 세그먼트 — 아이콘 없이 텍스트만 (시안 2a) */
function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const buttons: ReadonlyArray<{
    readonly value: ViewMode;
    readonly label: string;
    readonly testId: string;
  }> = [
    { value: "preview", label: "보기", testId: "mode-preview" },
    { value: "edit", label: "편집", testId: "mode-edit" },
    { value: "source", label: "소스", testId: "mode-source" },
    { value: "split", label: "분할", testId: "mode-split" },
  ];

  return (
    <div
      className="flex items-center rounded-full bg-[var(--color-seg-bg)] p-[3px] text-[12.5px]"
      data-testid="mode-toggle"
    >
      {buttons.map(({ value, label, testId }) => {
        const isActive = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={isActive}
            className={`whitespace-nowrap rounded-full px-3.5 py-1 transition-colors ${
              isActive
                ? "seg-active font-semibold text-[var(--color-text)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
            data-testid={testId}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
