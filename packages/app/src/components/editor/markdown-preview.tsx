import { useLayoutEffect, useRef } from "react";
import { useMarkdownHtml } from "../../hooks/use-markdown-html";
import { usePanelSearch } from "../../hooks/use-panel-search";
import { resolveLocalAssetUrl } from "../../lib/asset-url";
import { Spinner, ViewerLoading } from "../ui/spinner";
import { SearchBar } from "./search-bar";

interface MarkdownPreviewProps {
  readonly markdown: string;
  /**
   * 변환된 .md 파일의 절대 경로. 상대 이미지 경로(`./{문서명}_images/foo.png`)를
   * Tauri asset URL로 해석할 때의 기준 디렉토리로 사용된다.
   */
  readonly basePath?: string;
}

/**
 * 상대 이미지 경로를 Tauri asset URL 로 바꾼다. 링크(href) 등 다른 속성은
 * 건드리지 않는다. 화면에 붙기 전(`<template>` 안)에 바꿔야 잘못된 경로로
 * 요청이 먼저 나가지 않는다.
 */
function rewriteImageSources(root: ParentNode, basePath: string): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) img.setAttribute("src", resolveLocalAssetUrl(src, basePath));
  }
}

/**
 * 읽기 전용 Markdown 프리뷰 (GFM: 표·체크박스·취소선).
 *
 * Markdown → 정화된 HTML 은 Web Worker 가 만들고(`useMarkdownHtml`), 여기서는
 * 결과를 붙이기만 한다. 큰 표는 행 묶음으로 나뉘어 와서 화면 밖 묶음은
 * 브라우저가 그리지 않는다(`lib/markdown-html`). 결과 HTML 이 바뀔 때만 DOM 을
 * 갈아끼우므로 검색 입력·스토어 갱신 같은 재렌더가 문서를 다시 처리하지 않는다.
 *
 * 스타일링은 CSS var 기반 타이포그래피를 CSS에서 정의하며
 * 컨테이너에 `markdown-body` 클래스를 부여해 전역 스코프를 준다.
 */
export function MarkdownPreview({ markdown, basePath }: MarkdownPreviewProps) {
  const { html, error, isPending } = useMarkdownHtml(markdown);

  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { visible, focusToken, search, close } = usePanelSearch({
    containerRef,
    contentRef,
    // 검색은 붙어 있는 DOM 을 훑으므로 Markdown 이 아니라 붙인 HTML 기준으로 다시 센다
    resetKey: html,
  });

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || html === null) return;
    const template = document.createElement("template");
    template.innerHTML = html;
    if (basePath) rewriteImageSources(template.content, basePath);
    content.replaceChildren(template.content);
  }, [html, basePath]);

  // 스크롤은 contentRef(자식)에서 발생시키고, containerRef는 positioned
  // wrapper로만 둔다. 이렇게 해야 absolute로 띄운 SearchBar가 스크롤과
  // 함께 움직이지 않고 컨테이너 우상단에 고정된다.
  return (
    <div
      ref={containerRef}
      className="relative h-full"
      data-testid="markdown-preview"
      // 키 이벤트를 받기 위해 tabIndex 부여 (preview는 마우스/스크롤 영역이라
      // 기본 포커스 대상이 없으면 keydown이 컨테이너에 도달하지 못함)
      tabIndex={-1}
    >
      <SearchBar
        visible={visible}
        focusToken={focusToken}
        query={search.query}
        matches={search.matches}
        activeIndex={search.activeIndex}
        setQuery={search.setQuery}
        next={search.next}
        prev={search.prev}
        clear={search.clear}
        onClose={close}
      />
      {/* 내용은 useLayoutEffect 가 직접 붙인다 — React 자식을 두지 않는다 */}
      <div
        ref={contentRef}
        className="markdown-body h-full overflow-y-auto px-[26px] py-[22px] text-sm leading-relaxed"
        data-testid="markdown-preview-content"
      />
      {html === null && !error && (
        <div className="absolute inset-0">
          <ViewerLoading label="미리보기를 만드는 중..." />
        </div>
      )}
      {html !== null && isPending && (
        <div
          className="pointer-events-none absolute right-4 bottom-3 text-[var(--color-muted)]"
          data-testid="markdown-preview-pending"
        >
          <Spinner size={14} />
        </div>
      )}
      {error && (
        <div
          className="absolute inset-x-0 top-0 border-b border-[var(--color-border)] bg-[var(--color-error)]/10 px-[18px] py-1.5 text-xs text-[var(--color-error)]"
          data-testid="markdown-preview-error"
        >
          미리보기를 만들지 못했습니다: {error}
        </div>
      )}
    </div>
  );
}
