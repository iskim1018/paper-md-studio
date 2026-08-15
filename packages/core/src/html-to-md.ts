import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm has no type definitions
import { gfm } from "turndown-plugin-gfm";

let service: TurndownService | null = null;
let keepTablesService: TurndownService | null = null;

function buildService(): TurndownService {
  const service = new TurndownService({
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

function getService(): TurndownService {
  if (!service) service = buildService();
  return service;
}

/**
 * 표를 GFM으로 내리지 않고 HTML 원형(outerHTML)으로 남기는 변형 서비스.
 *
 * turndown-plugin-gfm은 colspan/rowspan을 버리고 셀 안 블록 요소마다 줄바꿈을
 * 내어, 병합 표가 GFM에서 통째로 깨진다. 표는 원형으로 남겨 두고
 * `normalizeHtmlTablesToGfm`(grid 정규화 + 병합 화살표)에 넘기는 것이
 * kordoc 경로와 같은 계약이다. addRule은 rules 배열 앞에 끼워 넣으므로
 * gfm 플러그인의 표 규칙보다 우선한다.
 */
function getKeepTablesService(): TurndownService {
  if (keepTablesService) return keepTablesService;

  keepTablesService = buildService();
  keepTablesService.addRule("keepTableAsHtml", {
    filter: "table",
    replacement: (_content, node) => {
      const el = node as unknown as { outerHTML: string };
      return `\n\n${el.outerHTML}\n\n`;
    },
  });
  return keepTablesService;
}

/** HTML 문자열을 GFM Markdown으로 변환 */
export function htmlToMarkdown(html: string): string {
  return getService().turndown(html);
}

/**
 * 표만 HTML로 남기고 나머지를 Markdown으로 변환.
 * 결과는 `normalizeHtmlTablesToGfm`으로 마저 내리는 것을 전제로 한다 (DOCX 경로).
 */
export function htmlToMarkdownKeepingTables(html: string): string {
  return getKeepTablesService().turndown(html);
}
