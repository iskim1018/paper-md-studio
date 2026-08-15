import type { ConvertResult, DocumentFormat } from "../store/file-store";

interface CliOutput {
  readonly markdown: string;
  readonly format: DocumentFormat;
  readonly elapsed: number;
  readonly imageCount: number;
  readonly outputPath: string;
  /** 변환은 됐지만 사용자가 알아야 할 사항 (예: 텍스트 없는 스캔 PDF) */
  readonly warnings?: Array<string>;
  /** 숨김 처리로 제외된 항목 수 (엑셀 전용) */
  readonly hiddenExcluded?: {
    readonly sheets: number;
    readonly rows: number;
    readonly cols: number;
  };
}

export interface ConvertOptions {
  /** 출력 디렉토리. null/undefined면 원본 파일과 같은 폴더에 저장. */
  readonly outputDir?: string | null;
  /** 출력 파일 전체 경로(.md). 지정 시 outputDir보다 우선. */
  readonly outputPath?: string | null;
  /** HTML 변환 시 원격 이미지를 {문서명}_images/로 다운로드 */
  readonly downloadImages?: boolean;
  /** 엑셀의 숨긴 시트·행·열도 변환에 포함 */
  readonly includeHidden?: boolean;
}

/**
 * sidecar CLI의 --html 경로로 뷰어용 HTML을 생성합니다.
 * HTML 포맷(로컬 .html / URL)은 Readability 본문 추출 + sanitize를
 * 거친 "변환될 본문"이 반환됩니다.
 */
export interface HtmlPreviewOptions {
  /** 엑셀의 숨긴 시트·행·열도 미리보기에 포함 (원본 확인 목적) */
  readonly includeHidden?: boolean;
}

export async function convertFileToHtml(
  inputPath: string,
  options: HtmlPreviewOptions = {},
): Promise<string> {
  const { Command } = await import("@tauri-apps/plugin-shell");

  const args = [inputPath, "--html"];
  if (options.includeHidden) args.push("--include-hidden");

  const command = Command.sidecar("binaries/paper-md-studio-cli", args);
  const output = await command.execute();

  if (output.code !== 0) {
    throw new Error(
      output.stderr.trim() || "원본 미리보기 생성 중 오류가 발생했습니다.",
    );
  }
  return output.stdout;
}

/**
 * sidecar CLI를 호출하여 문서를 변환합니다.
 * CLI는 --json 플래그로 JSON 결과를 stdout에 출력합니다.
 */
export async function convertFile(
  inputPath: string,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const { Command } = await import("@tauri-apps/plugin-shell");

  const args: Array<string> = [inputPath, "--json"];
  if (options.outputPath) {
    args.push("--output", options.outputPath);
  } else if (options.outputDir) {
    args.push("--output", options.outputDir);
  }
  if (options.downloadImages) {
    args.push("--download-images");
  }
  if (options.includeHidden) {
    args.push("--include-hidden");
  }

  const command = Command.sidecar("binaries/paper-md-studio-cli", args);

  const output = await command.execute();

  if (output.code !== 0) {
    const errorMessage =
      output.stderr.trim() ||
      output.stdout.trim() ||
      "변환 중 알 수 없는 오류가 발생했습니다.";
    throw new Error(errorMessage);
  }

  let result: CliOutput;
  try {
    result = JSON.parse(output.stdout);
  } catch {
    throw new Error(
      `CLI 출력 파싱 실패: ${output.stdout.slice(0, 200) || "(빈 출력)"}`,
    );
  }

  return {
    markdown: result.markdown,
    format: result.format,
    elapsed: result.elapsed,
    imageCount: result.imageCount,
    outputPath: result.outputPath,
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    ...(result.hiddenExcluded ? { hiddenExcluded: result.hiddenExcluded } : {}),
  };
}
