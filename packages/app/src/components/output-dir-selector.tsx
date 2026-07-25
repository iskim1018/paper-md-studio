import { RotateCcw } from "lucide-react";
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

/** 패널 하단 고정 출력 폴더 행 — `출력 <경로> 변경` (시안 2a) */
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
      className="flex shrink-0 items-center gap-1.5 border-t border-[var(--color-border)] px-[18px] py-2.5 text-[11.5px] text-[var(--color-muted)]"
      data-testid="output-dir-selector"
    >
      <span>출력</span>
      <span
        className="flex-1 truncate text-[var(--color-text-secondary)]"
        title={label}
        data-testid="output-dir-label"
      >
        {truncated}
      </span>
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
      <button
        type="button"
        onClick={handlePick}
        className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        data-testid="output-dir-pick-btn"
      >
        변경
      </button>
    </div>
  );
}
