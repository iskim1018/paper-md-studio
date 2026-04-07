import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm has no type definitions
import { gfm } from "turndown-plugin-gfm";

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) return service;

  service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  service.use(gfm);

  return service;
}

/** HTML 문자열을 GFM Markdown으로 변환 */
export function htmlToMarkdown(html: string): string {
  return getService().turndown(html);
}
