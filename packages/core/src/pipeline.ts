import { basename, extname } from "node:path";
import { htmlToMarkdown } from "./html-to-md.js";
import { normalizePath } from "./normalize.js";
import { DocxParser } from "./parsers/docx-parser.js";
import { HwpxParser } from "./parsers/hwpx-parser.js";
import { PdfParser } from "./parsers/pdf-parser.js";
import type {
  ConvertOptions,
  ConvertResult,
  DocumentFormat,
  Parser,
} from "./types.js";

const FORMAT_MAP: Record<string, DocumentFormat> = {
  ".hwpx": "hwpx",
  ".docx": "docx",
  ".pdf": "pdf",
};

const PARSER_MAP: Record<DocumentFormat, () => Parser> = {
  hwpx: () => new HwpxParser(),
  docx: () => new DocxParser(),
  pdf: () => new PdfParser(),
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

function defaultImagesDirName(inputPath: string): string {
  return `${basename(inputPath).replace(/\.[^.]+$/, "")}_images`;
}

/** HTML 중간 결과를 반환 (뷰어용) */
export interface HtmlResult {
  readonly html: string;
  readonly format: DocumentFormat;
}

export async function convertToHtml(
  options: ConvertOptions,
): Promise<HtmlResult> {
  const inputPath = normalizePath(options.inputPath);
  const format = detectFormat(inputPath);
  const imagesDirName =
    options.imagesDirName ?? defaultImagesDirName(inputPath);

  const parser = PARSER_MAP[format]();
  const parseResult = await parser.parse(inputPath, { imagesDirName });

  const html = parseResult.html ?? parseResult.markdown ?? "";
  return { html, format };
}

export async function convert(options: ConvertOptions): Promise<ConvertResult> {
  const start = performance.now();
  const inputPath = normalizePath(options.inputPath);
  const format = detectFormat(inputPath);
  const imagesDirName =
    options.imagesDirName ?? defaultImagesDirName(inputPath);

  const parser = PARSER_MAP[format]();
  const parseResult = await parser.parse(inputPath, { imagesDirName });

  let markdown: string;
  if (parseResult.markdown) {
    markdown = parseResult.markdown;
  } else if (parseResult.html) {
    markdown = htmlToMarkdown(parseResult.html);
  } else {
    throw new Error("파서가 HTML 또는 Markdown을 반환하지 않았습니다.");
  }

  return {
    markdown,
    images: parseResult.images,
    format,
    elapsed: performance.now() - start,
  };
}
