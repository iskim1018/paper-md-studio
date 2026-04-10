import { ChevronLeft, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readFileAsBytes } from "../../lib/file-reader";

interface PdfViewerProps {
  readonly filePath: string;
}

interface PdfState {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly scale: number;
}

interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (ctx: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

const INITIAL_SCALE = 1.0;
const SCALE_STEP = 0.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4.0;

async function loadPdfDocument(filePath: string): Promise<PdfDocument> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const bytes = await readFileAsBytes(filePath);
  return (await pdfjsLib.getDocument({ data: bytes })
    .promise) as unknown as PdfDocument;
}

async function renderPdfPage(
  pdfDoc: PdfDocument,
  canvas: HTMLCanvasElement,
  pageNum: number,
  scale: number,
): Promise<void> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  await page.render({ canvasContext: ctx, viewport }).promise;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PdfDocument | null>(null);
  const [state, setState] = useState<PdfState>({
    currentPage: 1,
    totalPages: 0,
    scale: INITIAL_SCALE,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    loadPdfDocument(filePath)
      .then((doc) => {
        if (cancelled) return;
        pdfDocRef.current = doc;
        setState({
          currentPage: 1,
          totalPages: doc.numPages,
          scale: INITIAL_SCALE,
        });
        const canvas = canvasRef.current;
        if (canvas) renderPdfPage(doc, canvas, 1, INITIAL_SCALE);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(`PDF 로드 실패: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    const pdfDoc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (pdfDoc && canvas && state.totalPages > 0) {
      renderPdfPage(pdfDoc, canvas, state.currentPage, state.scale);
    }
  }, [state.currentPage, state.scale, state.totalPages]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, state.totalPages));
      setState((prev) => ({ ...prev, currentPage: clamped }));
    },
    [state.totalPages],
  );

  const adjustScale = useCallback((delta: number) => {
    setState((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale + delta)),
    }));
  }, []);

  const fitToWidth = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || state.totalPages === 0) return;

    const containerWidth = container.clientWidth - 32;
    const currentCanvasWidth = canvas.clientWidth;
    if (currentCanvasWidth === 0) return;

    const newScale = (containerWidth / currentCanvasWidth) * state.scale;
    setState((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale)),
    }));
  }, [state.totalPages, state.scale]);

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
        PDF 로딩 중...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="pdf-viewer">
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex justify-center p-4 bg-[var(--color-panel-bg)]"
      >
        <canvas ref={canvasRef} />
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-[var(--color-border)] px-3 py-1.5 text-xs">
        <button
          type="button"
          onClick={() => goToPage(state.currentPage - 1)}
          disabled={state.currentPage <= 1}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30 transition-colors"
          aria-label="이전 페이지"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="tabular-nums">
          {state.currentPage} / {state.totalPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(state.currentPage + 1)}
          disabled={state.currentPage >= state.totalPages}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30 transition-colors"
          aria-label="다음 페이지"
        >
          <ChevronRight size={14} />
        </button>
        <span className="mx-1 text-[var(--color-border)]">|</span>
        <button
          type="button"
          onClick={() => adjustScale(-SCALE_STEP)}
          disabled={state.scale <= MIN_SCALE}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30 transition-colors"
          aria-label="축소"
        >
          <Minus size={14} />
        </button>
        <span className="tabular-nums w-12 text-center">
          {Math.round(state.scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => adjustScale(SCALE_STEP)}
          disabled={state.scale >= MAX_SCALE}
          className="p-1 rounded hover:bg-[var(--color-border)] disabled:opacity-30 transition-colors"
          aria-label="확대"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={fitToWidth}
          className="p-1 rounded hover:bg-[var(--color-border)] transition-colors"
          aria-label="너비 맞춤"
        >
          <Maximize size={14} />
        </button>
      </div>
    </div>
  );
}
