import { useEffect, useRef, useState } from "react";
import { readFileAsBytes } from "../../lib/file-reader";
import { sanitizeViewerHtml } from "../../lib/sanitize";

interface DocxViewerProps {
  readonly filePath: string;
}

interface DocxLoadResult {
  readonly html: string;
  readonly blobUrls: Array<string>;
}

async function convertImageToBlob(image: {
  read: (enc: string) => Promise<string>;
  contentType: string;
}): Promise<{ src: string; blobUrl: string }> {
  const base64Data = await image.read("base64");
  const mimeType = image.contentType || "image/png";
  const binaryStr = atob(base64Data);
  const binaryArr = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    binaryArr[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([binaryArr], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  return { src: blobUrl, blobUrl };
}

async function loadDocxFile(filePath: string): Promise<DocxLoadResult> {
  const mammoth = await import("mammoth");
  const bytes = await readFileAsBytes(filePath);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const blobUrls: Array<string> = [];

  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement((image) => {
        return convertImageToBlob(image).then(({ src, blobUrl }) => {
          blobUrls.push(blobUrl);
          return { src };
        });
      }),
    },
  );

  const html = sanitizeViewerHtml(result.value);

  return { html, blobUrls };
}

function revokeBlobUrls(urls: Array<string>): void {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

export function DocxViewer({ filePath }: DocxViewerProps) {
  const [htmlContent, setHtmlContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<Array<string>>([]);

  useEffect(() => {
    let cancelled = false;
    revokeBlobUrls(blobUrlsRef.current);
    blobUrlsRef.current = [];

    setIsLoading(true);
    setError(null);

    loadDocxFile(filePath)
      .then((result) => {
        if (cancelled) {
          revokeBlobUrls(result.blobUrls);
          return;
        }
        blobUrlsRef.current = result.blobUrls;
        setHtmlContent(result.html);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`DOCX 로드 실패: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      revokeBlobUrls(blobUrlsRef.current);
      blobUrlsRef.current = [];
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
        DOCX 로딩 중...
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      data-testid="docx-viewer"
    >
      <div
        ref={contentRef}
        className="docx-content p-4 text-sm leading-relaxed"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify로 sanitize 완료
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
}
