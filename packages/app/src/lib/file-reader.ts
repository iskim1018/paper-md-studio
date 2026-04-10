/**
 * Tauri fs 플러그인을 통한 로컬 파일 읽기 유틸리티.
 */

export async function readFileAsBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  try {
    return await readFile(path);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    throw new Error(`파일을 읽을 수 없습니다: ${path} (${message})`);
  }
}
