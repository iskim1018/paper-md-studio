import { FolderOpen, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { resolveRevealDir } from "../lib/output-path";
import { openDirectory } from "../lib/reveal";
import { useFileStore } from "../store/file-store";
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
  // "원본 폴더" 모드에서는 선택된 파일이 있는 곳이 곧 출력 위치다
  const selectedPath = useFileStore(
    (s) => s.files.find((f) => f.id === s.selectedFileId)?.path ?? null,
  );

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

  const [openError, setOpenError] = useState<string | null>(null);

  const revealDir = resolveRevealDir(outputDir, selectedPath);

  const handleReveal = useCallback(async () => {
    if (!revealDir) return;
    setOpenError(null);
    try {
      await openDirectory(revealDir);
    } catch (err: unknown) {
      // 조용히 삼키면 "눌러도 아무 일 없는" 버튼이 된다 (이전 구현의 문제)
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      setOpenError(message);
    }
  }, [revealDir]);

  const label = outputDir ?? "원본 폴더";
  const truncated =
    label.length > 40 ? `…${label.slice(label.length - 39)}` : label;

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-t border-[var(--color-border)] px-[18px] py-2.5 text-[11.5px] text-[var(--color-muted)]"
      data-testid="output-dir-selector"
    >
      <span>출력</span>
      {openError ? (
        <span
          className="flex-1 truncate text-[var(--color-error)]"
          title={openError}
          data-testid="output-dir-error"
        >
          폴더를 열 수 없습니다 — {openError}
        </span>
      ) : (
        <span
          className="flex-1 truncate text-[var(--color-text-secondary)]"
          title={label}
          data-testid="output-dir-label"
        >
          {truncated}
        </span>
      )}
      <button
        type="button"
        onClick={handleReveal}
        disabled={revealDir === null}
        className="rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:cursor-default disabled:opacity-35 disabled:hover:text-[var(--color-muted)] transition-colors"
        title={
          revealDir
            ? `폴더 열기 — ${revealDir}`
            : "파일을 선택하면 저장 위치를 열 수 있습니다"
        }
        aria-label="출력 폴더 열기"
        data-testid="output-dir-open-btn"
      >
        <FolderOpen size={12} />
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
