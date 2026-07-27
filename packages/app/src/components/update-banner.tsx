import { Download, X } from "lucide-react";
import { useAppUpdate } from "../hooks/use-app-update";
import { Spinner } from "./ui/spinner";

/**
 * 새 버전 알림 배너. 헤더 아래에 얇게 깔리며, 업데이트가 없으면
 * 아무것도 렌더하지 않는다 (레이아웃 영향 0).
 */
export function UpdateBanner() {
  const { stage, version, progress, error, install, dismiss } = useAppUpdate();

  if (stage === "idle") return null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-chip-bg)] px-[18px] py-2 text-[13px]"
      data-testid="update-banner"
      role="status"
    >
      {stage === "error" ? (
        <span className="text-[var(--color-error)]">{error}</span>
      ) : stage === "downloading" || stage === "ready" ? (
        <>
          <Spinner size={14} className="text-[var(--color-accent)]" />
          <span>
            {stage === "ready"
              ? "설치 완료 — 앱을 다시 시작합니다"
              : progress === null
                ? "업데이트 내려받는 중..."
                : `업데이트 내려받는 중... ${progress}%`}
          </span>
        </>
      ) : (
        <>
          <Download size={14} className="text-[var(--color-accent)]" />
          <span>
            새 버전 <strong className="font-semibold">v{version}</strong>이
            있습니다
          </span>
          <button
            type="button"
            onClick={install}
            className="ml-1 cursor-pointer rounded-[6px] bg-[var(--color-accent)] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            data-testid="update-install-btn"
          >
            지금 설치
          </button>
        </>
      )}

      <button
        type="button"
        onClick={dismiss}
        className="ml-auto cursor-pointer rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        aria-label="알림 닫기"
        data-testid="update-dismiss-btn"
      >
        <X size={14} />
      </button>
    </div>
  );
}
