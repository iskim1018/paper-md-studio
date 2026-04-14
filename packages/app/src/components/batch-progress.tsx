import { X } from "lucide-react";
import { useConvertQueueStore } from "../store/convert-queue-store";

export function BatchProgress() {
  const { running, pending, completed, failed, active, cancelAll } =
    useConvertQueueStore();

  const total = running + pending + completed + failed;
  if (!active && total === 0) return null;

  const done = completed + failed;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel-bg)] px-3 py-1.5 text-xs"
      data-testid="batch-progress"
    >
      <span className="font-medium text-[var(--color-text)]">
        {done}/{total}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full bg-[var(--color-accent)] transition-all"
          style={{ width: `${percent}%` }}
          data-testid="batch-progress-bar"
        />
      </div>
      <span className="text-[var(--color-muted)]">{percent}%</span>
      {failed > 0 && (
        <span
          className="rounded bg-[var(--color-error)]/15 px-1.5 py-0.5 text-[var(--color-error)]"
          data-testid="batch-failed-badge"
        >
          실패 {failed}
        </span>
      )}
      {active && (
        <button
          type="button"
          onClick={cancelAll}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
          title="대기 중인 작업 취소 (진행 중인 변환은 끝까지 수행)"
          data-testid="batch-cancel-btn"
        >
          <X size={11} />
          취소
        </button>
      )}
    </div>
  );
}
