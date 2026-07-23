import { useCallback } from "react";
import { scanFolderForDocuments } from "../lib/folder-scan";
import { useFileStore } from "../store/file-store";

/** 파일 다이얼로그에서 허용할 확장자 */
const DIALOG_EXTENSIONS = [
  "hwp",
  "hwpx",
  "doc",
  "docx",
  "pdf",
  "html",
  "htm",
  "md",
];

/** 네이티브 다이얼로그 기반 파일/폴더 추가 핸들러 */
export function useFilePickers(): {
  openFiles: () => Promise<void>;
  openFolder: () => Promise<void>;
} {
  const addFiles = useFileStore((s) => s.addFiles);
  const addScannedFiles = useFileStore((s) => s.addScannedFiles);

  const openFiles = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "변환할 문서 선택",
      filters: [{ name: "문서", extensions: DIALOG_EXTENSIONS }],
    });
    if (!picked) return;
    addFiles(Array.isArray(picked) ? picked : [picked]);
  }, [addFiles]);

  const openFolder = useCallback(async () => {
    const { open, message } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "변환할 폴더 선택" });
    if (typeof dir !== "string") return;
    try {
      const scanned = await scanFolderForDocuments(dir);
      const added = addScannedFiles(scanned);
      if (added === 0) {
        await message(
          "선택한 폴더에서 지원하는 문서를 찾지 못했습니다.\n(지원: .hwp, .hwpx, .doc, .docx, .pdf, .html, .md)",
          { title: "폴더 열기", kind: "info" },
        );
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      await message(`폴더를 읽는 중 오류가 발생했습니다.\n${detail}`, {
        title: "폴더 열기",
        kind: "error",
      });
    }
  }, [addScannedFiles]);

  return { openFiles, openFolder };
}
