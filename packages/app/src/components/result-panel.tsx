import {
  Check,
  Code,
  Columns2,
  Copy,
  Edit3,
  Eye,
  FileCode2,
  FolderOpen,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useFileStore } from "../store/file-store";
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
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<ViewMode>("preview");

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
      <div className="flex-1 overflow-hidden">
        {mode === "preview" && (
          <div className="h-full overflow-y-auto">
            <pre
              className="p-4 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed"
              data-testid="markdown-output"
            >
              {displayedMarkdown}
            </pre>
          </div>
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
              <MilkdownEditor
                key={`split-milk-${selectedFile.id}`}
                initialValue={displayedMarkdown}
                onChange={handleEdit}
              />
            </Panel>
            <PanelResizeHandle className="w-px bg-[var(--color-border)] hover:bg-[var(--color-accent,#3b82f6)] transition-colors" />
            <Panel defaultSize={50} minSize={20}>
              <div className="h-full overflow-y-auto border-l border-[var(--color-border)]">
                <pre
                  className="p-4 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed"
                  data-testid="split-preview"
                >
                  {displayedMarkdown}
                </pre>
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
