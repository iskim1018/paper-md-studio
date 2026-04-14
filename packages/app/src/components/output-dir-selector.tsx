import { FolderOutput, RotateCcw } from "lucide-react";
import { useCallback } from "react";
import { useSettingsStore } from "../store/settings-store";

async function pickDirectory(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    title: "출력 폴더 선택",
  });
  if (picked === null || Array.isArray(picked)) return null;
  return picked;
}

export function OutputDirSelector() {
  const outputDir = useSettingsStore((s) => s.outputDir);
  const setOutputDir = useSettingsStore((s) => s.setOutputDir);

  const handlePick = useCallback(async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setOutputDir(dir);
    } catch {
      // 다이얼로그 취소/실패는 무시
    }
  }, [setOutputDir]);

  const handleReset = useCallback(() => {
    setOutputDir(null);
  }, [setOutputDir]);

  const label = outputDir ?? "원본 폴더";
  const truncated =
    label.length > 40 ? `…${label.slice(label.length - 39)}` : label;

  return (
    <div
      className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 py-1.5 text-xs"
      data-testid="output-dir-selector"
    >
      <FolderOutput size={12} className="text-[var(--color-muted)]" />
      <span className="text-[var(--color-muted)]">출력:</span>
      <button
        type="button"
        onClick={handlePick}
        className="flex-1 truncate text-left text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors"
        title={label}
        data-testid="output-dir-pick-btn"
      >
        {truncated}
      </button>
      {outputDir !== null && (
        <button
          type="button"
          onClick={handleReset}
          className="rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          title="원본 폴더로 되돌리기"
          data-testid="output-dir-reset-btn"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}
