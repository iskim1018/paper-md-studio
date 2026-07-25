import { X } from "lucide-react";
import { useConvertQueueStore } from "../store/convert-queue-store";

/** 배치 변환 진행 — 텍스트 행 + 2px 헤어라인 진행바 (플랫, 배경 블록 없음) */
export function BatchProgress() {
  const { running, pending, completed, failed, active, cancelAll } =
    useConvertQueueStore();

  const total = running + pending + completed + failed;
  if (!active && total === 0) return null;

  const done = completed + failed;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="shrink-0 px-[18px] pb-2" data-testid="batch-progress">
      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span className="flex items-center gap-2">
          <span>
            {active ? "변환 중" : "변환"} {done}/{total}
          </span>
          {failed > 0 && (
            <span
              className="text-[var(--color-error)]"
              data-testid="batch-failed-badge"
            >
              실패 {failed}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span>{percent}%</span>
          {active && (
            <button
              type="button"
              onClick={cancelAll}
              className="flex items-center gap-0.5 hover:text-[var(--color-error)] transition-colors"
              title="대기 중인 작업 취소 (진행 중인 변환은 끝까지 수행)"
              data-testid="batch-cancel-btn"
            >
              <X size={11} />
              취소
            </button>
          )}
        </span>
      </div>
      <div className="h-[2px] bg-[var(--color-border)]">
        <div
          className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
          style={{ width: `${percent}%` }}
          data-testid="batch-progress-bar"
        />
      </div>
    </div>
  );
}
