import { ChevronDown, ChevronRight, FileSearch } from "lucide-react";
import { useState } from "react";
import { useFileStore } from "../store/file-store";
import { DocxViewer } from "./viewers/docx-viewer";
import { HwpxViewer } from "./viewers/hwpx-viewer";
import { PdfViewer } from "./viewers/pdf-viewer";

export function PreviewPanel() {
  const { files, selectedFileId } = useFileStore();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const [showMeta, setShowMeta] = useState(false);

  if (!selectedFile) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]"
        data-testid="preview-empty"
      >
        <FileSearch size={32} />
        <p className="text-sm">파일을 선택하세요</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="preview-panel">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
          원본 미리보기
        </span>
        <span
          className="text-xs text-[var(--color-muted)] truncate max-w-[60%]"
          title={selectedFile.name}
        >
          {selectedFile.name}
        </span>
      </div>

      <div className="flex-1 overflow-hidden">
        <FileViewer format={selectedFile.format} filePath={selectedFile.path} />
      </div>

      <div className="border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setShowMeta((prev) => !prev)}
          className="flex w-full items-center gap-1 px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
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
    case "hwp":
    case "hwpx":
      // .hwp는 HwpxViewer가 CLI sidecar(--html)를 통해 처리한다.
      // core의 convertToHtml이 내부적으로 HwpParser → HWPX 선변환을 수행.
      return <HwpxViewer filePath={filePath} />;
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
