import { useEffect, useState } from "react";
import { isSupportedFile, useFileStore } from "../store/file-store";

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface DragHandlers {
  setIsDragging: (v: boolean) => void;
  addFiles: (paths: ReadonlyArray<string>) => void;
}

function createDragHandler({ setIsDragging, addFiles }: DragHandlers) {
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
      const paths = event.payload.paths.filter(isSupportedFile);
      if (paths.length > 0) {
        addFiles(paths);
      }
    }
  };
}

export function DropOverlay() {
  const [isDragging, setIsDragging] = useState(false);
  const addFiles = useFileStore((s) => s.addFiles);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const webview = getCurrentWebview();
      const handler = createDragHandler({ setIsDragging, addFiles });

      unlisten = await webview.onDragDropEvent(handler);
    };

    setup();
    return () => {
      unlisten?.();
    };
  }, [addFiles]);

  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-bg)]/90 px-12 py-8 text-center">
        <p className="text-lg font-medium">파일을 놓으세요</p>
        <p className="text-sm text-[var(--color-muted)]">.hwpx, .docx, .pdf</p>
      </div>
    </div>
  );
}
