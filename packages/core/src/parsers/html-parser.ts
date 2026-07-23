import { readFile } from "node:fs/promises";
import { decodeHtml } from "../html/decode-html.js";
import { extractContent } from "../html/extract-content.js";
import { fetchHtml } from "../html/fetch-html.js";
import { isHttpUrl } from "../html/is-url.js";
import { renderSpa } from "../html/render-spa.js";
import { resolveUrls } from "../html/resolve-urls.js";
import { sanitizeHtml } from "../html/sanitize-html.js";
import type {
  HtmlConvertOptions,
  ParseOptions,
  ParseResult,
  Parser,
} from "../types.js";

interface LoadedHtml {
  readonly html: string;
  readonly baseUrl: string | undefined;
}

export class HtmlParser implements Parser {
  async parse(inputPath: string, options: ParseOptions): Promise<ParseResult> {
    const htmlOptions = options.html ?? {};
    const { html, baseUrl } = await loadHtml(inputPath, htmlOptions);

    const shouldExtract = htmlOptions.extractContent !== false;
    let title: string | null = null;
    let content = html;
    if (shouldExtract) {
      const extracted = extractContent(html, baseUrl);
      title = extracted.title;
      content = extracted.contentHtml;
    }

    let cleaned = resolveUrls(sanitizeHtml(content), baseUrl);
    if (title && !/<h1[\s>]/i.test(cleaned)) {
      cleaned = `<h1>${escapeHtml(title)}</h1>\n${cleaned}`;
    }

    return { html: cleaned, markdown: null, images: [] };
  }
}

async function loadHtml(
  inputPath: string,
  options: HtmlConvertOptions,
): Promise<LoadedHtml> {
  if (isHttpUrl(inputPath)) {
    if (options.renderSpa) {
      const rendered = await renderSpa(inputPath, {
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.waitSelector ? { waitSelector: options.waitSelector } : {}),
      });
      return { html: rendered, baseUrl: inputPath };
    }
    const fetched = await fetchHtml(inputPath, {
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
    return { html: fetched.html, baseUrl: fetched.finalUrl };
  }

  if (options.renderSpa) {
    throw new Error(
      "SPA 렌더링(--render)은 URL 입력에서만 사용할 수 있습니다.",
    );
  }

  if (options.baseUrl && !isHttpUrl(options.baseUrl)) {
    throw new Error(`baseUrl은 http(s) URL이어야 합니다: ${options.baseUrl}`);
  }

  const bytes = await readFile(inputPath);
  return { html: decodeHtml(bytes), baseUrl: options.baseUrl };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
