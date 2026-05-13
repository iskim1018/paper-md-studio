import { useEffect } from "react";
import { useFileStore } from "../store/file-store";

/**
 * .md 파일은 이미 markdown이므로 변환 큐(CLI 호출)를 거칠 필요가 없다.
 * D&D나 파일 선택으로 등록된 직후 `status: "pending"`이면 즉시 원본을 읽어
 * `status: "done"`으로 마킹한다. 결과적으로 사용자는 변환 버튼을 누르지 않아도
 * 우측 Markdown 영역에 곧바로 콘텐츠를 본다.
 *
 * App 루트에서 한 번만 호출하면 진입점(D&D, 다이얼로그)에 무관하게 동작한다.
 */
export function useAutoLoadMarkdown(): void {
  const files = useFileStore((s) => s.files);
  const updateFile = useFileStore((s) => s.updateFile);

  useEffect(() => {
    const pending = files.filter(
      (f) => f.format === "md" && f.status === "pending",
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const ids = pending.map((f) => f.id);
    // 중복 처리 방지: 즉시 "converting" 상태로 마킹해 후속 effect 재실행에서
    // 다시 선택되지 않게 한다.
    for (const id of ids) {
      updateFile(id, { status: "converting" });
    }

    (async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      for (const file of pending) {
        if (cancelled) return;
        try {
          const markdown = await readTextFile(file.path);
          if (cancelled) return;
          updateFile(file.id, {
            status: "done",
            result: {
              markdown,
              format: "md",
              elapsed: 0,
              imageCount: 0,
              outputPath: file.path,
            },
          });
        } catch (err) {
          if (cancelled) return;
          const message =
            err instanceof Error ? err.message : "Markdown 파일 읽기 실패";
          updateFile(file.id, { status: "error", error: message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, updateFile]);
}
