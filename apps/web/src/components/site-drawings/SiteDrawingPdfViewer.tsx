import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// A dedicated multi-page document viewer for the Site Drawing Hub --
// DrawingViewer.tsx (components/drawing/) is a single-page, pin-overlay
// canvas built for the Buildlense Captures floor-plan feature and isn't a
// fit here (no pin placement, needs page navigation instead). This reuses
// the same proven pdf.js technique for a robust render (timeout + retry +
// cancellation-aware, since some CAD-exported PDFs take pdf.js's canvas
// renderer an impractically long time to rasterize -- see DrawingViewer's
// own comment on the real file that motivated this), without copying its
// pin-specific code.
export function SiteDrawingPdfViewer({ fileUrl, onNumPages }: { fileUrl: string; onNumPages?: (n: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // fileUrl is a presigned URL: its signature/expiry changes on every
  // refetch even when the underlying file hasn't (see
  // SiteDrawingsService.getAuthorizedDownloadUrl's 15-minute expiry) --
  // keyed on the stable part so a background refetch doesn't restart an
  // in-progress render.
  const fileUrlRef = useRef(fileUrl);
  fileUrlRef.current = fileUrl;
  const stableUrlKey = fileUrl.split('?')[0];

  useEffect(() => {
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;
    setLoading(true);
    setError(null);
    pdfjsLib.getDocument(fileUrlRef.current).promise.then((doc) => {
      if (cancelled) { doc.destroy(); return; }
      loaded = doc;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setPage(1);
      onNumPages?.(doc.numPages);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setError('Could not load this drawing.'); setLoading(false); }
    });
    return () => { cancelled = true; loaded?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableUrlKey]);

  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    let currentRenderTask: ReturnType<pdfjsLib.PDFPageProxy['render']> | null = null;

    async function attemptRender(pdfPage: pdfjsLib.PDFPageProxy, canvas: HTMLCanvasElement, viewport: pdfjsLib.PageViewport, timeoutMs: number): Promise<'done' | 'timeout'> {
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'done';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      currentRenderTask = renderTask;
      let timedOut = false;
      const timeout = new Promise<'timeout'>((resolve) => {
        setTimeout(() => { timedOut = true; renderTask.cancel(); resolve('timeout'); }, timeoutMs);
      });
      const result = await Promise.race([renderTask.promise.then(() => 'done' as const), timeout]);
      if (result === 'timeout' || timedOut) return 'timeout';
      return 'done';
    }

    async function render() {
      try {
        const pdfPage = await pdfDoc!.getPage(Math.min(Math.max(1, page), pdfDoc!.numPages));
        if (cancelled) return;
        const containerWidth = containerRef.current?.clientWidth ?? 900;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = (containerWidth / baseViewport.width) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        let outcome = await attemptRender(pdfPage, canvas, viewport, 5000);
        if (outcome === 'timeout' && !cancelled) outcome = await attemptRender(pdfPage, canvas, viewport, 5000);
        if (outcome === 'timeout' && !cancelled) outcome = await attemptRender(pdfPage, canvas, viewport, 15000);
        if (cancelled) return;
        if (outcome === 'timeout') throw new Error('RENDER_TIMEOUT');
      } catch (err) {
        const isCancellation = err instanceof Error && err.name === 'RenderingCancelledException';
        if (!cancelled && !isCancellation) {
          setError(
            err instanceof Error && err.message === 'RENDER_TIMEOUT'
              ? 'This drawing is too complex to preview in the browser. Try opening it at the source instead.'
              : 'Could not render this page.',
          );
        }
      }
    }
    render();
    return () => { cancelled = true; currentRenderTask?.cancel(); };
  }, [pdfDoc, page, zoom]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-base-600 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost !px-2 !py-2 text-xs disabled:opacity-40">
            Prev
          </button>
          <span className="text-xs text-ink-300 tabular-nums px-2">Page {page} of {numPages || '—'}</span>
          <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages} className="btn-ghost !px-2 !py-2 text-xs disabled:opacity-40">
            Next
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="btn-ghost !px-2 !py-2 text-xs">−</button>
          <span className="text-xs text-ink-500 tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="btn-ghost !px-2 !py-2 text-xs">+</button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto bg-base-950 flex items-start justify-center p-4">
        {loading && (
          <div className="flex items-center justify-center h-full text-sm text-ink-500">Loading drawing…</div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-sm text-danger text-center max-w-sm">{error}</div>
        )}
        {!error && <canvas role="img" aria-label="Site drawing page" ref={canvasRef} className="shadow-lg" style={{ display: loading ? 'none' : 'block' }} />}
      </div>
    </div>
  );
}
