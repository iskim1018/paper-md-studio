import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

interface HwpxViewerProps {
  readonly filePath: string;
}

async function loadHwpxHtml(filePath: string): Promise<string> {
  const { Command } = await import("@tauri-apps/plugin-shell");
  const command = Command.sidecar("binaries/docs-to-md-cli", [
    filePath,
    "--html",
  ]);
  const output = await command.execute();

  if (output.code !== 0) {
    const errorMessage = output.stderr.trim() || "HWPX HTML 변환 실패";
    throw new Error(errorMessage);
  }

  return DOMPurify.sanitize(output.stdout, {
    ADD_TAGS: ["img"],
    ADD_ATTR: ["src", "alt"],
  });
}

export function HwpxViewer({ filePath }: HwpxViewerProps) {
  const [htmlContent, setHtmlContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    loadHwpxHtml(filePath)
      .then((html) => {
        if (!cancelled) setHtmlContent(html);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`HWPX 로드 실패: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
        HWPX 로딩 중...
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      data-testid="hwpx-viewer"
    >
      <div
        className="hwpx-content p-4 text-sm leading-relaxed"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify로 sanitize 완료
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
}
