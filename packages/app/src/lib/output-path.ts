import { exists } from "@tauri-apps/plugin-fs";
import { isHttpUrl, urlToSlug } from "./url-input";

/**
 * 변환될 .md 파일의 경로를 CLI와 동일한 규칙으로 계산한다.
 * - 입력: `/foo/bar/문서.hwpx`, outputDir `/out` → `/out/문서.md`
 * - outputDir 없으면 입력 파일과 같은 디렉토리에 저장
 */
export function computeDefaultOutputPath(
  inputPath: string,
  outputDir: string | null | undefined,
): string {
  // URL 입력은 원본 디렉토리가 없으므로 슬러그 파일명만 계산한다.
  // (outputDir 미설정 시 호출측에서 저장 위치를 물어본다)
  if (isHttpUrl(inputPath)) {
    const fileName = `${urlToSlug(inputPath)}.md`;
    if (!outputDir) return fileName;
    const sep =
      outputDir.includes("\\") && !outputDir.includes("/") ? "\\" : "/";
    const trimmed = outputDir.endsWith(sep)
      ? outputDir.slice(0, -1)
      : outputDir;
    return `${trimmed}${sep}${fileName}`;
  }

  const sep = inputPath.includes("\\") && !inputPath.includes("/") ? "\\" : "/";
  const segments = inputPath.split(sep);
  const baseName = segments[segments.length - 1] ?? inputPath;
  const mdFileName = baseName.replace(/\.[^.]+$/, ".md");
  const dir = outputDir ?? segments.slice(0, -1).join(sep);
  const trimmed = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${mdFileName}`;
}

export type ResolveOutcome =
  | { readonly kind: "proceed"; readonly outputPath: string }
  | { readonly kind: "skip" };

// 배치 변환은 동시성 5로 실행되지만 네이티브 대화상자는 한 번에
// 하나만 떠야 하므로, 대화상자가 필요한 항목은 체인으로 직렬화한다.
let dialogChain: Promise<unknown> = Promise.resolve();

function enqueueDialog<T>(task: () => Promise<T>): Promise<T> {
  const next = dialogChain.then(task, task);
  dialogChain = next.catch(() => undefined);
  return next;
}

async function askSaveLocation(defaultPath: string): Promise<ResolveOutcome> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    title: "변환 결과 저장 위치",
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!picked) {
    return { kind: "skip" };
  }
  const withExt = picked.toLowerCase().endsWith(".md")
    ? picked
    : `${picked}.md`;
  return { kind: "proceed", outputPath: withExt };
}

/**
 * 목표 경로에 파일이 이미 존재하면 사용자에게 덮어쓸지/다른 이름으로 저장할지/
 * 건너뛸지 물어본다. 충돌이 없으면 기본 경로를 그대로 반환.
 */
export async function resolveOutputPath(
  inputPath: string,
  outputDir: string | null | undefined,
): Promise<ResolveOutcome> {
  const defaultPath = computeDefaultOutputPath(inputPath, outputDir);

  // URL 입력 + 출력 디렉토리 미설정: 저장 위치를 사용자에게 물어본다
  if (isHttpUrl(inputPath) && !outputDir) {
    return enqueueDialog(() => askSaveLocation(defaultPath));
  }

  let conflict = false;
  try {
    conflict = await exists(defaultPath);
  } catch (err) {
    // 권한/경로 이슈 등은 CLI가 처리하게 두고 그대로 진행 (로깅은 유지)
    // biome-ignore lint/suspicious/noConsole: 디버깅용, 문제 진단에 필요
    console.warn("[output-path] exists() 실패:", defaultPath, err);
    return { kind: "proceed", outputPath: defaultPath };
  }

  if (!conflict) {
    return { kind: "proceed", outputPath: defaultPath };
  }

  return enqueueDialog(() => askConflictResolution(defaultPath));
}

async function askConflictResolution(
  defaultPath: string,
): Promise<ResolveOutcome> {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  const overwrite = await ask(
    `'${defaultPath}'\n\n같은 이름의 파일이 이미 존재합니다.\n덮어쓰시겠습니까? (취소 → 다른 이름으로 저장)`,
    {
      title: "파일 충돌",
      kind: "warning",
      okLabel: "덮어쓰기",
      cancelLabel: "다른 이름",
    },
  );

  if (overwrite) {
    return { kind: "proceed", outputPath: defaultPath };
  }

  return askSaveLocation(defaultPath);
}
