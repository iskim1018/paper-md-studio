import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 자동 업데이트 확인/설치 훅.
 *
 * 정책: 앱 시작 시 조용히 확인하고, 새 버전이 있을 때만 배너로 알린다.
 * 설치 여부는 사용자가 결정한다 (자동 설치 안 함).
 *
 * 업데이터 플러그인은 데스크톱 번들에만 존재하므로 동적 import로 불러오고,
 * 개발 서버·테스트 환경처럼 Tauri 런타임이 없는 곳에서는 조용히 비활성된다.
 */

export type UpdateStage =
  | "idle"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdateState {
  readonly stage: UpdateStage;
  /** 새 버전 문자열 (예: "0.5.2"). 없으면 null. */
  readonly version: string | null;
  /** 0~100. 전체 크기를 모르면 null. */
  readonly progress: number | null;
  readonly error: string | null;
  /** 다운로드 후 설치하고 앱을 재시작한다. */
  install: () => void;
  /** 배너를 닫는다 (이번 실행 동안 다시 뜨지 않음). */
  dismiss: () => void;
}

/** 업데이트 확인을 시작 직후가 아니라 살짝 미뤄 초기 렌더를 방해하지 않는다. */
const CHECK_DELAY_MS = 3000;

interface DownloadProgressEvent {
  readonly event: "Started" | "Progress" | "Finished";
  readonly data?: {
    readonly contentLength?: number;
    readonly chunkLength?: number;
  };
}

/** Tauri 업데이터가 반환하는 Update 객체 중 이 훅이 쓰는 부분만. */
interface UpdateHandle {
  readonly version: string;
  downloadAndInstall: (
    onEvent: (event: DownloadProgressEvent) => void,
  ) => Promise<void>;
}

/**
 * 다운로드 이벤트를 0~100 진행률로 환산하는 누적기.
 * 전체 크기를 모르면(contentLength 없음) null을 유지한다.
 */
function createProgressTracker(
  onPercent: (percent: number | null) => void,
): (event: DownloadProgressEvent) => void {
  let downloaded = 0;
  let total = 0;

  return (event) => {
    if (event.event === "Started") {
      total = event.data?.contentLength ?? 0;
      return;
    }
    if (event.event === "Finished") {
      onPercent(100);
      return;
    }
    downloaded += event.data?.chunkLength ?? 0;
    if (total > 0) {
      onPercent(Math.min(100, Math.round((downloaded / total) * 100)));
    }
  };
}

export function useAppUpdate(): AppUpdateState {
  const [stage, setStage] = useState<UpdateStage>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<UpdateHandle | null>(null);

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const found = await check();
          if (cancelled || !found) return;
          updateRef.current = found as unknown as UpdateHandle;
          setVersion(found.version);
          setStage("available");
        } catch {
          // Tauri 런타임 없음 / 네트워크 실패 / 엔드포인트 부재 —
          // 업데이트 확인 실패는 앱 사용을 막을 이유가 없으므로 조용히 넘어간다.
        }
      })();
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const install = useCallback(() => {
    const update = updateRef.current;
    if (!update) return;

    setStage("downloading");
    setProgress(null);
    setError(null);

    void (async () => {
      try {
        await update.downloadAndInstall(createProgressTracker(setProgress));

        setStage("ready");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`업데이트 설치 실패: ${message}`);
        setStage("error");
      }
    })();
  }, []);

  const dismiss = useCallback(() => {
    setStage("idle");
    setError(null);
  }, []);

  return { stage, version, progress, error, install, dismiss };
}
