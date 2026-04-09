import { Check, Copy, FileCode2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useFileStore } from "../store/file-store";

export function ResultPanel() {
  const { files, selectedFileId } = useFileStore();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!selectedFile?.result?.markdown) return;
    await navigator.clipboard.writeText(selectedFile.result.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selectedFile]);

  if (!selectedFile || selectedFile.status !== "done" || !selectedFile.result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
        <FileCode2 size={32} />
        <p className="text-sm">변환 결과가 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
          Markdown
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <pre className="p-4 text-sm whitespace-pre-wrap break-words font-mono leading-relaxed">
          {selectedFile.result.markdown}
        </pre>
      </div>
    </div>
  );
}
