import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useTextSearch } from "../../hooks/use-text-search";
import { resolveLocalAssetUrl } from "../../lib/asset-url";
import { SearchBar } from "./search-bar";

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

  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const search = useTextSearch({
    containerRef: contentRef,
    resetKey: markdown,
  });

  const handleClose = useCallback(() => {
    setSearchVisible(false);
    search.clear();
  }, [search]);

  // 컨테이너 영역에서 발생한 Cmd/Ctrl+F를 가로채 검색바를 토글.
  // focus가 컨테이너 내부일 때만 동작 (source editor의 Cmd+F와 충돌 회피).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const isFind = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
      if (!isFind) return;
      const target = e.target as Node | null;
      // 컨테이너 안에서 발생한 이벤트만 처리
      if (!target || !container.contains(target)) return;
      e.preventDefault();
      setSearchVisible(true);
    };
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto"
      data-testid="markdown-preview"
      // 키 이벤트를 받기 위해 tabIndex 부여 (preview는 마우스/스크롤 영역이라
      // 기본 포커스 대상이 없으면 keydown이 컨테이너에 도달하지 못함)
      tabIndex={-1}
    >
      <SearchBar
        visible={searchVisible}
        query={search.query}
        matches={search.matches}
        activeIndex={search.activeIndex}
        setQuery={search.setQuery}
        next={search.next}
        prev={search.prev}
        clear={search.clear}
        onClose={handleClose}
      />
      <div
        ref={contentRef}
        className="markdown-body p-4 text-sm leading-relaxed"
      >
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
