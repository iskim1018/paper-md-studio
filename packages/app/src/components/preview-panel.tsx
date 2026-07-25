import { ChevronDown, ChevronRight, FileSearch } from "lucide-react";
import { useState } from "react";
import { useFileStore } from "../store/file-store";
import { DocViewer } from "./viewers/doc-viewer";
import { DocxViewer } from "./viewers/docx-viewer";
import { HtmlViewer } from "./viewers/html-viewer";
import { HwpxViewer } from "./viewers/hwpx-viewer";
import { PdfViewer } from "./viewers/pdf-viewer";

export function PreviewPanel() {
  const { files, selectedFileId } = useFileStore();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const [showMeta, setShowMeta] = useState(false);

  if (!selectedFile) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--color-panel-bg)] text-[var(--color-muted)]"
        data-testid="preview-empty"
      >
        <FileSearch
          size={28}
          strokeWidth={1.5}
          className="text-[var(--color-dot-pending)]"
        />
        <p className="text-[13px]">파일을 선택하면 원본이 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="preview-panel">
      <div className="flex items-center justify-between px-[18px] pt-3.5 pb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
          원본 미리보기
        </span>
        <span
          className="max-w-[65%] truncate text-xs text-[var(--color-muted)]"
          title={selectedFile.name}
        >
          {selectedFile.name}
        </span>
      </div>

      <div className="flex-1 overflow-hidden border-t border-[var(--color-border)]">
        <FileViewer format={selectedFile.format} filePath={selectedFile.path} />
      </div>

      <div className="border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setShowMeta((prev) => !prev)}
          className="flex w-full items-center gap-1 px-[18px] py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          data-testid="meta-toggle"
        >
          {showMeta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          파일 정보
        </button>
        {showMeta && (
          <div className="border-t border-[var(--color-border)] px-3 py-2">
            <dl className="space-y-1.5 text-xs">
              <MetaRow label="경로" value={selectedFile.path} mono />
              <MetaRow label="형식" value={selectedFile.format.toUpperCase()} />
              <MetaRow label="상태" value={selectedFile.status} />
              {selectedFile.status === "done" && selectedFile.result && (
                <>
                  <MetaRow
                    label="변환 시간"
                    value={`${selectedFile.result.elapsed.toFixed(0)}ms`}
                  />
                  <MetaRow
                    label="이미지 수"
                    value={`${selectedFile.result.imageCount}개`}
                  />
                </>
              )}
              {selectedFile.status === "error" && selectedFile.error && (
                <MetaRow label="오류" value={selectedFile.error} error />
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

interface FileViewerProps {
  readonly format: string;
  readonly filePath: string;
}

function FileViewer({ format, filePath }: FileViewerProps) {
  switch (format) {
    case "pdf":
      return <PdfViewer filePath={filePath} />;
    case "docx":
      return <DocxViewer filePath={filePath} />;
    case "doc":
      return <DocViewer filePath={filePath} />;
    case "hwp":
    case "hwpx":
      return <HwpxViewer filePath={filePath} />;
    case "md":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[var(--color-muted)]">
          <FileSearch size={32} />
          <p className="text-sm">Markdown 원본 파일</p>
          <p className="text-xs">
            오른쪽 Markdown 영역에서 콘텐츠를 확인하세요.
          </p>
        </div>
      );
    case "html":
      return <HtmlViewer filePath={filePath} />;
    default:
      return (
        <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
          지원하지 않는 형식입니다
        </div>
      );
  }
}

interface MetaRowProps {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly error?: boolean;
}

function MetaRow({ label, value, mono, error }: MetaRowProps) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-[var(--color-muted)] w-16">{label}</dt>
      <dd
        className={`break-all ${mono ? "font-mono" : ""} ${error ? "text-[var(--color-error)]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
