/**
 * 파일 관리자(Finder/탐색기) 연동.
 *
 * `@tauri-apps/plugin-shell`의 `open`은 2.1.0부터 deprecated이고, JS에서
 * 호출하면 기본 검증 정규식(`^((mailto:\w+)|(tel:\w+)|(https?://\w+)).+`)에
 * 걸려 파일 경로로는 아예 동작하지 않는다. 후속인 opener 플러그인을 쓴다.
 */

import { isMacPlatform } from "./shortcuts";

/** 이 플랫폼의 파일 관리자 이름 — 안내 문구에 그대로 쓴다. */
export function fileManagerName(): string {
  return isMacPlatform() ? "Finder" : "탐색기";
}

/** 디렉토리를 파일 관리자로 연다 (폴더 내용이 보인다). */
export async function openDirectory(dir: string): Promise<void> {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(dir);
}

/**
 * 파일이 있는 폴더를 열고 그 파일을 선택 상태로 보여준다.
 * 폴더만 여는 것보다 "방금 만든 결과물이 이것"을 짚어주기 좋다.
 */
export async function revealFile(filePath: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(filePath);
}
