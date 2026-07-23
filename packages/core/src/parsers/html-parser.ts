import { readFile } from "node:fs/promises";
import { decodeHtml } from "../html/decode-html.js";
import { downloadImages } from "../html/download-images.js";
import { extractContent } from "../html/extract-content.js";
import { fetchHtml } from "../html/fetch-html.js";
import { findMainFrameSrc, MAX_FRAME_DEPTH } from "../html/frame-follow.js";
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

    // zero-width space 등 보이지 않는 문자 제거 (네이버 에디터가 빈 줄마다 삽입)
    let cleaned = resolveUrls(sanitizeHtml(content), baseUrl).replace(
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: zero-width 문자 제거가 목적
      /[\u200B\u200C\u200D\uFEFF]/g,
      "",
    );

    let images: ParseResult["images"] = [];
    if (htmlOptions.downloadImages) {
      const downloaded = await downloadImages(cleaned, options.imagesDirName, {
        ...(htmlOptions.timeoutMs ? { timeoutMs: htmlOptions.timeoutMs } : {}),
      });
      cleaned = downloaded.html;
      images = downloaded.images;
    }

    if (title && !/<h1[\s>]/i.test(cleaned)) {
      cleaned = `<h1>${escapeHtml(title)}</h1>\n${cleaned}`;
    }

    return { html: cleaned, markdown: null, images };
  }
}

async function loadHtml(
  inputPath: string,
  options: HtmlConvertOptions,
): Promise<LoadedHtml> {
  if (isHttpUrl(inputPath)) {
    if (options.renderSpa) {
      const render = (url: string) =>
        renderSpa(url, {
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.waitSelector
            ? { waitSelector: options.waitSelector }
            : {}),
        });
      const rendered = await render(inputPath);
      return followFrames(
        { html: rendered, baseUrl: inputPath },
        async (u) => ({
          html: await render(u),
          baseUrl: u,
        }),
      );
    }
    const fetch = async (url: string): Promise<LoadedHtml> => {
      const fetched = await fetchHtml(url, {
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
      return { html: fetched.html, baseUrl: fetched.finalUrl };
    };
    return followFrames(await fetch(inputPath), fetch);
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

/**
 * 프레임 껍데기 페이지(예: 네이버 블로그)면 본문 프레임을 따라간다.
 * 각 hop의 fetch/render는 safeFetch·validateFetchUrl로 SSRF 재검증된다.
 */
async function followFrames(
  initial: LoadedHtml,
  load: (url: string) => Promise<LoadedHtml>,
): Promise<LoadedHtml> {
  let current = initial;
  for (let depth = 0; depth < MAX_FRAME_DEPTH; depth += 1) {
    const baseUrl = current.baseUrl;
    if (!baseUrl) break;
    const frameSrc = findMainFrameSrc(current.html, baseUrl);
    if (!frameSrc || frameSrc === baseUrl) break;
    current = await load(frameSrc);
  }
  return current;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
