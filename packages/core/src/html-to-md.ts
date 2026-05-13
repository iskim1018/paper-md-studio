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

  // GFM 표 셀 안의 <br>은 기본 동작(`  \n`)으로 출력되면 셀이 깨진다.
  // 표 내부 BR은 HTML 그대로 유지해 GFM 렌더러가 줄바꿈으로 처리하게 한다.
  // tsconfig에 DOM lib이 없어 turndown의 HTMLElement 타입을 직접 못 쓰므로
  // 필요한 속성만 duck-type으로 좁힌다.
  type DomLike = { nodeName: string; parentNode: DomLike | null };
  service.addRule("brInTableCell", {
    filter: (node) => {
      const n = node as unknown as DomLike;
      if (n.nodeName !== "BR") return false;
      let parent: DomLike | null = n.parentNode;
      while (parent) {
        if (parent.nodeName === "TD" || parent.nodeName === "TH") return true;
        if (parent.nodeName === "TABLE") return false;
        parent = parent.parentNode;
      }
      return false;
    },
    replacement: () => "<br>",
  });

  return service;
}

/** HTML 문자열을 GFM Markdown으로 변환 */
export function htmlToMarkdown(html: string): string {
  return getService().turndown(html);
}
