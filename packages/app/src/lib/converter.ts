import type { ConvertResult, DocumentFormat } from "../store/file-store";

interface CliOutput {
  readonly markdown: string;
  readonly format: DocumentFormat;
  readonly elapsed: number;
  readonly imageCount: number;
}

/**
 * sidecar CLI를 호출하여 문서를 변환합니다.
 * CLI는 --json 플래그로 JSON 결과를 stdout에 출력합니다.
 */
export async function convertFile(inputPath: string): Promise<ConvertResult> {
  const { Command } = await import("@tauri-apps/plugin-shell");

  const command = Command.sidecar("binaries/docs-to-md-cli", [
    inputPath,
    "--json",
  ]);

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
  };
}
