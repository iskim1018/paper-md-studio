import {
  Check,
  Code,
  Columns2,
  Copy,
  Edit3,
  Eye,
  FileCode2,
  FolderOpen,
  Save,
  SaveAll,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSaveShortcut } from "../hooks/use-save-shortcut";
import { saveMarkdownAs, saveMarkdownTo } from "../lib/file-writer";
import { useFileStore } from "../store/file-store";
import { MarkdownPreview } from "./editor/markdown-preview";
import { MilkdownEditor } from "./editor/milkdown-editor";
import { SourceEditor } from "./editor/source-editor";

type ViewMode = "preview" | "edit" | "source" | "split";

async function openFolder(filePath: string): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-shell");
  const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
  await open(folderPath);
}

export function ResultPanel() {
  const { files, selectedFileId } = useFileStore();
  const setEditedMarkdown = useFileStore((s) => s.setEditedMarkdown);
  const markSaved = useFileStore((s) => s.markSaved);
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
    if (!selectedFile?.result?.outputPath) return;
    await openFolder(selectedFile.result.outputPath);
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

  if (!selectedFile || selectedFile.status !== "done" || !selectedFile.result) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]"
        data-testid="result-empty"
      >
        <FileCode2 size={32} />
        <p className="text-sm">변환 결과가 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="result-panel">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
            Markdown
          </span>
          {selectedFile.isDirty && (
            <span
              className="text-xs text-[var(--color-accent,#3b82f6)]"
              title="저장되지 않은 편집 있음"
              data-testid="dirty-indicator"
            >
              ●
            </span>
          )}
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedFile.isDirty}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="저장 (Cmd/Ctrl+S)"
            data-testid="save-btn"
          >
            <Save size={12} />
            저장
          </button>
          <button
            type="button"
            onClick={handleSaveAs}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            title="다른 이름으로 저장 (Cmd/Ctrl+Shift+S)"
            data-testid="save-as-btn"
          >
            <SaveAll size={12} />
            다른 이름
          </button>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            title={selectedFile.result.outputPath}
            data-testid="open-folder-btn"
          >
            <FolderOpen size={12} />
            폴더 열기
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </div>
      {saveError && (
        <div
          className="border-b border-[var(--color-error)] bg-[var(--color-error)]/10 px-3 py-1.5 text-xs text-[var(--color-error)]"
          data-testid="save-error"
        >
          저장 오류: {saveError}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {mode === "preview" && <MarkdownPreview markdown={displayedMarkdown} />}
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
            // 파일이 바뀌거나 WYSIWYG 편집 후 소스 모드로 돌아올 때
            // 초기값을 다시 반영하도록 편집 내용 길이를 key에 포함
            key={`src-${selectedFile.id}-${displayedMarkdown.length}`}
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
                key={`split-src-${selectedFile.id}-${displayedMarkdown.length}`}
                initialValue={displayedMarkdown}
                onChange={handleEdit}
              />
            </Panel>
            <PanelResizeHandle className="w-px bg-[var(--color-border)] hover:bg-[var(--color-accent,#3b82f6)] transition-colors" />
            <Panel defaultSize={50} minSize={20}>
              <div
                className="h-full border-l border-[var(--color-border)]"
                data-testid="split-preview"
              >
                <MarkdownPreview markdown={displayedMarkdown} />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>
      <div className="border-t border-[var(--color-border)] px-3 py-1.5">
        <p
          className="text-xs text-[var(--color-muted)] truncate"
          title={selectedFile.result.outputPath}
          data-testid="output-path"
        >
          저장: {selectedFile.result.outputPath}
        </p>
      </div>
    </div>
  );
}

interface ModeToggleProps {
  readonly mode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
}

function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const buttons: ReadonlyArray<{
    readonly value: ViewMode;
    readonly label: string;
    readonly Icon: typeof Eye;
    readonly testId: string;
  }> = [
    { value: "preview", label: "보기", Icon: Eye, testId: "mode-preview" },
    { value: "edit", label: "편집", Icon: Edit3, testId: "mode-edit" },
    { value: "source", label: "소스", Icon: Code, testId: "mode-source" },
    { value: "split", label: "분할", Icon: Columns2, testId: "mode-split" },
  ];

  return (
    <div
      className="flex items-center rounded border border-[var(--color-border)] text-xs"
      data-testid="mode-toggle"
    >
      {buttons.map(({ value, label, Icon, testId }, i) => {
        const isActive = mode === value;
        const radius =
          i === 0 ? "rounded-l" : i === buttons.length - 1 ? "rounded-r" : "";
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={`flex items-center gap-1 px-2 py-0.5 ${radius} transition-colors ${
              isActive
                ? "bg-[var(--color-border)] text-[var(--color-text)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
            data-testid={testId}
          >
            <Icon size={11} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
