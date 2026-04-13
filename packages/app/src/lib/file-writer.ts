import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * 지정된 경로에 Markdown을 덮어쓴다. 실패 시 예외를 전파한다.
 */
export async function saveMarkdownTo(
  path: string,
  content: string,
): Promise<void> {
  await writeTextFile(path, content);
}

/**
 * 저장 다이얼로그를 띄워 사용자가 선택한 경로에 Markdown을 기록한다.
 *
 * @param defaultPath 다이얼로그의 기본 경로/파일명 (원본 MD 경로 권장)
 * @param content 저장할 Markdown 문자열
 * @returns 저장된 경로, 취소 시 null
 */
export async function saveMarkdownAs(
  defaultPath: string,
  content: string,
): Promise<string | null> {
  const picked = await saveDialog({
    defaultPath,
    filters: [
      {
        name: "Markdown",
        extensions: ["md"],
      },
    ],
  });

  if (picked === null) return null;

  await writeTextFile(picked, content);
  return picked;
}
