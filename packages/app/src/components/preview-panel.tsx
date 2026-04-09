import { FileSearch } from "lucide-react";
import { useFileStore } from "../store/file-store";

export function PreviewPanel() {
  const { files, selectedFileId } = useFileStore();
  const selectedFile = files.find((f) => f.id === selectedFileId);

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
      <div className="flex items-center border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
          원본 정보
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-muted)]">파일명</dt>
            <dd className="font-medium break-all">{selectedFile.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-muted)]">경로</dt>
            <dd className="text-xs break-all text-[var(--color-muted)]">
              {selectedFile.path}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-muted)]">형식</dt>
            <dd className="font-medium uppercase">{selectedFile.format}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-muted)]">상태</dt>
            <dd className="font-medium">{selectedFile.status}</dd>
          </div>
          {selectedFile.status === "done" && selectedFile.result && (
            <>
              <div>
                <dt className="text-xs text-[var(--color-muted)]">변환 시간</dt>
                <dd>{selectedFile.result.elapsed.toFixed(0)}ms</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-muted)]">이미지 수</dt>
                <dd>{selectedFile.result.imageCount}개</dd>
              </div>
            </>
          )}
          {selectedFile.status === "error" && selectedFile.error && (
            <div>
              <dt className="text-xs text-[var(--color-muted)]">오류</dt>
              <dd className="text-[var(--color-error)]">
                {selectedFile.error}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
