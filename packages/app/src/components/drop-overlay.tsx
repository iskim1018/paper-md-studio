import type { DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { isSupportedFile, useFileStore } from "../store/file-store";

function handleDragEvent(
  event: { payload: DragDropEvent },
  setIsDragging: (v: boolean) => void,
  addFiles: (paths: ReadonlyArray<string>) => void,
) {
  const { type } = event.payload;

  if (type === "over" || type === "enter") {
    setIsDragging(true);
    return;
  }

  if (type === "leave") {
    setIsDragging(false);
    return;
  }

  if (type === "drop") {
    setIsDragging(false);
    const paths = event.payload.paths.filter(isSupportedFile);
    if (paths.length > 0) {
      addFiles(paths);
    }
  }
}

export function DropOverlay() {
  const [isDragging, setIsDragging] = useState(false);
  const addFiles = useFileStore((s) => s.addFiles);

  useEffect(() => {
    const webview = getCurrentWebview();
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await webview.onDragDropEvent((event) => {
        handleDragEvent(event, setIsDragging, addFiles);
      });
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
