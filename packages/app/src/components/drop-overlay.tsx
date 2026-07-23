import { useEffect, useState } from "react";
import type { DroppedPathSinks } from "../lib/dropped-paths";
import { useFileStore } from "../store/file-store";

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface DragHandlers extends DroppedPathSinks {
  setIsDragging: (v: boolean) => void;
}

function createDragHandler({ setIsDragging, ...sinks }: DragHandlers) {
  return (event: { payload: { type: string; paths?: Array<string> } }) => {
    const { type } = event.payload;

    if (type === "over" || type === "enter") {
      setIsDragging(true);
      return;
    }

    if (type === "leave") {
      setIsDragging(false);
      return;
    }

    if (type === "drop" && event.payload.paths) {
      setIsDragging(false);
      const paths = event.payload.paths;
      void import("../lib/dropped-paths").then(({ addDroppedPaths }) =>
        addDroppedPaths(paths, sinks),
      );
    }
  };
}

export function DropOverlay() {
  const [isDragging, setIsDragging] = useState(false);
  const addFiles = useFileStore((s) => s.addFiles);
  const addScannedFiles = useFileStore((s) => s.addScannedFiles);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const webview = getCurrentWebview();
      const handler = createDragHandler({
        setIsDragging,
        addFiles,
        addScannedFiles,
      });

      unlisten = await webview.onDragDropEvent(handler);
    };

    setup();
    return () => {
      unlisten?.();
    };
  }, [addFiles, addScannedFiles]);

  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-bg)]/90 px-12 py-8 text-center">
        <p className="text-lg font-medium">파일 또는 폴더를 놓으세요</p>
        <p className="text-sm text-[var(--color-muted)]">
          .hwpx, .docx, .pdf, .html, .md · 폴더는 하위 문서까지 추가
        </p>
      </div>
    </div>
  );
}
