import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { resolveLocalAssetUrl } from "../../lib/asset-url";

/**
 * GitHub 기본 sanitize 스키마에 우리 변환 결과가 사용하는 인라인 HTML을
 * 추가 허용한다.
 * - `br`: 표 셀 안 줄바꿈 (HWPX 중첩 표 평탄화에서 사용)
 * - `td/th`의 `colspan`/`rowspan`: 부모 표 병합 셀 보존
 */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "br"],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    td: [
      ...((defaultSchema.attributes?.td as Array<unknown>) ?? []),
      "colspan",
      "rowspan",
    ],
    th: [
      ...((defaultSchema.attributes?.th as Array<unknown>) ?? []),
      "colspan",
      "rowspan",
    ],
  },
};

interface MarkdownPreviewProps {
  readonly markdown: string;
  /**
   * 변환된 .md 파일의 절대 경로. 상대 이미지 경로(`./{문서명}_images/foo.png`)를
   * Tauri asset URL로 해석할 때의 기준 디렉토리로 사용된다.
   */
  readonly basePath?: string;
}

/**
 * react-markdown 기반 읽기 전용 Markdown 프리뷰.
 * GFM (테이블, 체크박스, 취소선)을 remark-gfm으로 활성화한다.
 *
 * 스타일링은 CSS var 기반 타이포그래피를 CSS에서 정의하며
 * 컨테이너에 `markdown-body` 클래스를 부여해 전역 스코프를 준다.
 *
 * basePath가 주어지면 이미지 src의 상대 경로를 webview가 접근할 수 있는
 * Tauri asset URL로 변환한다. 다른 속성(href 등)은 기본 sanitization만 적용.
 */
export function MarkdownPreview({ markdown, basePath }: MarkdownPreviewProps) {
  const urlTransform = useMemo(() => {
    if (!basePath) return undefined;
    return (url: string, key: string, node: Readonly<{ tagName: string }>) => {
      const sanitized = defaultUrlTransform(url);
      if (sanitized === undefined || sanitized === null) return sanitized;
      // 이미지(img.src, source.srcset 등)에 한해 로컬 경로를 asset URL로 치환.
      const isImageSrc = key === "src" && node.tagName === "img";
      if (!isImageSrc) return sanitized;
      return resolveLocalAssetUrl(sanitized, basePath);
    };
  }, [basePath]);

  return (
    <div className="h-full overflow-y-auto" data-testid="markdown-preview">
      <div className="markdown-body p-4 text-sm leading-relaxed">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
          urlTransform={urlTransform}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
