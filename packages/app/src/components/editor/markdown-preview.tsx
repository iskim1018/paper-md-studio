import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
  readonly markdown: string;
}

/**
 * react-markdown 기반 읽기 전용 Markdown 프리뷰.
 * GFM (테이블, 체크박스, 취소선)을 remark-gfm으로 활성화한다.
 *
 * 스타일링은 CSS var 기반 타이포그래피를 CSS에서 정의하며
 * 컨테이너에 `markdown-body` 클래스를 부여해 전역 스코프를 준다.
 */
export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  return (
    <div className="h-full overflow-y-auto" data-testid="markdown-preview">
      <div className="markdown-body p-4 text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
