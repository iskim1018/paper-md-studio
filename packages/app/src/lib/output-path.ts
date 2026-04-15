import { exists } from "@tauri-apps/plugin-fs";

/**
 * 변환될 .md 파일의 경로를 CLI와 동일한 규칙으로 계산한다.
 * - 입력: `/foo/bar/문서.hwpx`, outputDir `/out` → `/out/문서.md`
 * - outputDir 없으면 입력 파일과 같은 디렉토리에 저장
 */
export function computeDefaultOutputPath(
  inputPath: string,
  outputDir: string | null | undefined,
): string {
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

/**
 * 목표 경로에 파일이 이미 존재하면 사용자에게 덮어쓸지/다른 이름으로 저장할지/
 * 건너뛸지 물어본다. 충돌이 없으면 기본 경로를 그대로 반환.
 */
export async function resolveOutputPath(
  inputPath: string,
  outputDir: string | null | undefined,
): Promise<ResolveOutcome> {
  const defaultPath = computeDefaultOutputPath(inputPath, outputDir);

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

  const { ask, save } = await import("@tauri-apps/plugin-dialog");
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

  const picked = await save({
    title: "다른 이름으로 저장",
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
