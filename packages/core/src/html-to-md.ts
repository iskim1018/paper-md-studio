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

  // turndown-plugin-gfm@1.0.2의 strikethrough 규칙이 단일 `~text~`로
  // 변환하는 버그가 있어 GFM 스펙(`~~text~~`)에 맞춰 override.
  service.addRule("strikethrough", {
    filter: ["del", "s", "strike"],
    replacement: (content) => `~~${content}~~`,
  });

  return service;
}

/** HTML 문자열을 GFM Markdown으로 변환 */
export function htmlToMarkdown(html: string): string {
  return getService().turndown(html);
}
