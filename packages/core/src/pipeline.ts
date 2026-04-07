import { extname } from "node:path";
import { normalizePath } from "./normalize.js";
import type { ConvertOptions, ConvertResult, DocumentFormat } from "./types.js";

const FORMAT_MAP: Record<string, DocumentFormat> = {
  ".hwpx": "hwpx",
  ".docx": "docx",
  ".pdf": "pdf",
};

function detectFormat(filePath: string): DocumentFormat {
  const ext = extname(filePath).toLowerCase();
  const format = FORMAT_MAP[ext];
  if (!format) {
    throw new Error(
      `지원하지 않는 파일 형식입니다: ${ext} (지원: .hwpx, .docx, .pdf)`,
    );
  }
  return format;
}

export async function convert(options: ConvertOptions): Promise<ConvertResult> {
  const start = performance.now();
  const inputPath = normalizePath(options.inputPath);
  const format = detectFormat(inputPath);

  // Phase 1에서 각 파서 구현 예정
  const result: ConvertResult = {
    markdown: "",
    images: [],
    format,
    elapsed: 0,
  };

  switch (format) {
    case "hwpx":
      // TODO: Phase 1 - HWPX 파서 구현
      throw new Error("HWPX 변환은 아직 구현되지 않았습니다.");
    case "docx":
      // TODO: Phase 1 - DOCX 파서 구현
      throw new Error("DOCX 변환은 아직 구현되지 않았습니다.");
    case "pdf":
      // TODO: Phase 1 - PDF 파서 구현
      throw new Error("PDF 변환은 아직 구현되지 않았습니다.");
  }

  result.elapsed = performance.now() - start;
  return result;
}
