import { useEffect } from "react";
import { useFileStore } from "../store/file-store";

/**
 * .md 파일은 이미 markdown이므로 변환 큐(CLI 호출)를 거칠 필요가 없다.
 * 등록 직후 `status: "pending"`이면 즉시 원본을 읽어 `status: "done"`으로
 * 마킹한다. 사용자가 변환 버튼을 누르지 않아도 우측 Markdown 영역에 곧바로
 * 콘텐츠가 표시된다.
 *
 * 구현 노트: useEffect deps에 `files`를 두면 updateFile이 즉시 files를 바꿔
 * effect가 재실행되고 cleanup이 처리 중인 비동기 작업을 취소해버린다. 그래서
 * effect는 mount-only(빈 deps)로 두고 zustand의 `subscribe`로 store 변화를
 * 추적한다. 중복 처리 방지는 `inFlight` 집합으로.
 */
export function useAutoLoadMarkdown(): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  useEffect(() => {
    const inFlight = new Set<string>();

    const processFile = async (id: string, path: string) => {
      if (inFlight.has(id)) return;
      inFlight.add(id);
      const { updateFile } = useFileStore.getState();
      updateFile(id, { status: "converting" });
      try {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const markdown = await readTextFile(path);
        updateFile(id, {
          status: "done",
          result: {
            markdown,
            format: "md",
            elapsed: 0,
            imageCount: 0,
            outputPath: path,
          },
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Markdown 파일 읽기 실패";
        updateFile(id, { status: "error", error: message });
      } finally {
        inFlight.delete(id);
      }
    };

    const scan = () => {
      const { files } = useFileStore.getState();
      for (const f of files) {
        if (f.format === "md" && f.status === "pending") {
          void processFile(f.id, f.path);
        }
      }
    };

    scan();
    const unsubscribe = useFileStore.subscribe(scan);
    return unsubscribe;
  }, []);
}
