import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ExtractedContent {
  /** 문서 제목 (없으면 null) */
  readonly title: string | null;
  /** 추출된 본문 HTML (fragment) */
  readonly contentHtml: string;
  /** Readability 추출 성공 여부 (false면 body 전체 폴백) */
  readonly usedReadability: boolean;
}

/** Readability 결과가 이보다 짧으면 추출 실패로 간주하고 폴백 */
const MIN_EXTRACTED_TEXT_LENGTH = 80;

type ReadabilityDocument = ConstructorParameters<typeof Readability>[0];

/**
 * HTML에서 본문을 추출한다 (nav/sidebar/footer 등 제거).
 * Readability 휴리스틱을 쓰고, 실패하면 body 전체로 폴백한다.
 */
export function extractContent(
  html: string,
  baseUrl?: string,
): ExtractedContent {
  const source = baseUrl ? injectBaseTag(html, baseUrl) : html;
  const { document } = parseHTML(source);
  const title = document.querySelector("title")?.textContent?.trim() || null;

  // linkedom Document는 Readability가 쓰는 DOM API 부분집합을 구현하므로
  // 구조적으로 호환된다 (nominal 타입만 달라 이중 캐스트 필요)
  const article = tryReadability(document as unknown as ReadabilityDocument);
  if (article) {
    return {
      title: article.title?.trim() || title,
      contentHtml: article.content,
      usedReadability: true,
    };
  }

  // 폴백: Readability가 document를 변형하므로 원본을 다시 파싱
  const { document: fresh } = parseHTML(source);
  const body = fresh.querySelector("body");
  return {
    title,
    contentHtml: body ? body.innerHTML : html,
    usedReadability: false,
  };
}

interface ReadabilityArticle {
  readonly title: string | null;
  readonly content: string;
}

function tryReadability(
  document: ReadabilityDocument,
): ReadabilityArticle | null {
  try {
    const article = new Readability(document).parse();
    if (!article?.content) {
      return null;
    }
    const textLength = (article.textContent ?? "").trim().length;
    if (textLength < MIN_EXTRACTED_TEXT_LENGTH) {
      return null;
    }
    return { title: article.title ?? null, content: article.content };
  } catch {
    return null;
  }
}

/** 상대 URL 해석을 위해 <base href>를 주입한다 (기존 base가 없을 때만) */
function injectBaseTag(html: string, baseUrl: string): string {
  if (/<base[\s>]/i.test(html)) {
    return html;
  }
  const baseTag = `<base href="${baseUrl.replace(/"/g, "&quot;")}">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}
