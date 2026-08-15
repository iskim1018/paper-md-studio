import { basename, extname } from "node:path";
import { isHttpUrl } from "./html/is-url.js";
import { urlToSlug } from "./html/url-slug.js";
import { htmlToMarkdown } from "./html-to-md.js";
import { normalizePath } from "./normalize.js";
import { DocParser } from "./parsers/doc-parser.js";
import { DocxParser } from "./parsers/docx-parser.js";
import { HtmlParser } from "./parsers/html-parser.js";
import { HwpParser } from "./parsers/hwp-parser.js";
import { HwpxParser } from "./parsers/hwpx-parser.js";
import { KordocParser } from "./parsers/kordoc-adapter.js";
import { PdfParser } from "./parsers/pdf-parser.js";
import { XlsxParser } from "./parsers/xlsx-parser.js";
import type {
  ConvertOptions,
  ConvertResult,
  DocumentFormat,
  ImageAsset,
  ParseOptions,
  Parser,
} from "./types.js";

const FORMAT_MAP: Record<string, DocumentFormat> = {
  ".hwp": "hwp",
  ".hwpx": "hwpx",
  ".doc": "doc",
  ".docx": "docx",
  ".pdf": "pdf",
  ".html": "html",
  ".htm": "html",
  ".xlsx": "xlsx",
  ".xls": "xls",
};

const PARSER_MAP: Record<DocumentFormat, () => Parser> = {
  hwp: () => new HwpParser(),
  hwpx: () => new HwpxParser(),
  doc: () => new DocParser(),
  docx: () => new DocxParser(),
  pdf: () => new PdfParser(),
  html: () => new HtmlParser(),
  // .xlsx는 자체 파서 — 표시형식·그림·하이퍼링크·숨김은 kordoc이 읽지 않는
  // 파트라 위임하면 복원할 수 없다. .xls(바이너리 BIFF)는 kordoc 유지.
  xlsx: () => new XlsxParser(),
  xls: () => new KordocParser({ normalizeTables: true }),
};

function detectFormat(filePath: string): DocumentFormat {
  const ext = extname(filePath).toLowerCase();
  const format = FORMAT_MAP[ext];
  if (!format) {
    throw new Error(
      `지원하지 않는 파일 형식입니다: ${ext} (지원: .hwp, .hwpx, .doc, .docx, .pdf, .html, .xlsx, .xls)`,
    );
  }
  return format;
}

function defaultImagesDirName(inputPath: string): string {
  if (isHttpUrl(inputPath)) {
    return `${urlToSlug(inputPath)}_images`;
  }
  return `${basename(inputPath).replace(/\.[^.]+$/, "")}_images`;
}

/** 입력을 정규화하고 포맷을 결정한다 (URL은 NFC 정규화 없이 html 포맷) */
function resolveInput(options: ConvertOptions): {
  inputPath: string;
  format: DocumentFormat;
} {
  if (isHttpUrl(options.inputPath)) {
    return { inputPath: options.inputPath, format: "html" };
  }
  const inputPath = normalizePath(options.inputPath);
  return { inputPath, format: detectFormat(inputPath) };
}

function toParseOptions(
  options: ConvertOptions,
  imagesDirName: string,
): ParseOptions {
  return {
    imagesDirName,
    ...(options.html ? { html: options.html } : {}),
  };
}

/** HTML 중간 결과를 반환 (뷰어용) */
export interface HtmlResult {
  readonly html: string;
  readonly format: DocumentFormat;
}

/** 이미지 상대경로를 base64 data URI로 치환 */
function inlineImages(
  html: string,
  images: Array<ImageAsset>,
  imagesDirName: string,
): string {
  let result = html;
  for (const img of images) {
    const relativePath = `./${imagesDirName}/${img.name}`;
    const base64 = Buffer.from(img.data).toString("base64");
    const dataUri = `data:${img.mimeType};base64,${base64}`;
    result = result.replaceAll(`src="${relativePath}"`, `src="${dataUri}"`);
  }
  return result;
}

export async function convertToHtml(
  options: ConvertOptions,
): Promise<HtmlResult> {
  const { inputPath, format } = resolveInput(options);
  const imagesDirName =
    options.imagesDirName ?? defaultImagesDirName(inputPath);

  const parser = PARSER_MAP[format]();
  const parseResult = await parser.parse(
    inputPath,
    toParseOptions(options, imagesDirName),
  );

  const rawHtml = parseResult.html ?? parseResult.markdown ?? "";
  const html =
    parseResult.images.length > 0
      ? inlineImages(rawHtml, parseResult.images, imagesDirName)
      : rawHtml;

  return { html, format };
}

export async function convert(options: ConvertOptions): Promise<ConvertResult> {
  const start = performance.now();
  const { inputPath, format } = resolveInput(options);
  const imagesDirName =
    options.imagesDirName ?? defaultImagesDirName(inputPath);

  const parser = PARSER_MAP[format]();
  const parseResult = await parser.parse(
    inputPath,
    toParseOptions(options, imagesDirName),
  );

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
    ...(parseResult.warnings && parseResult.warnings.length > 0
      ? { warnings: parseResult.warnings }
      : {}),
  };
}
