import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Pin } from '../../lib/drawings.api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;



export function DrawingViewer({
  fileUrl,
  isPdf,
  page = 1,
  pins,
  placingMode,
  onPlacePin,
  onPinClick,
  onNumPages,
}: {
  fileUrl: string;
  isPdf: boolean;
  // 1-indexed PDF page to render. Ignored for non-PDF (raster image) drawings.
  page?: number;
  pins: Pin[];
  placingMode?: boolean;
  onPlacePin?: (xNorm: number, yNorm: number) => void;
  onPinClick?: (pin: Pin) => void;
  // Fires once per document load with the PDF's total page count, so the
  // caller can show page navigation controls for multi-page drawings.
  onNumPages?: (numPages: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // fileUrl is a presigned URL: its signature and expiry change on every
  // query refetch even when the underlying file hasn't. Re-running this
  // effect on every such refetch (e.g. React Query's refetch-on-window-
  // focus) would restart the PDF/image render from scratch each time --
  // if a refetch lands mid-render, the render never gets a chance to
  // finish. Key the effect on the stable part of the URL (path, no query
  // string) instead, and read the always-current fileUrl via a ref.
  const fileUrlRef = useRef(fileUrl);
  fileUrlRef.current = fileUrl;
  const stableUrlKey = fileUrl.split('?')[0];

  // PDF document loading is split from page rendering: loading is expensive
  // (fetch + parse the whole file) and should happen once per drawing, not
  // once per page flip. It's also stateful on pdf.js's side -- a loaded
  // PDFDocumentProxy owns a worker-side resource that MUST be released via
  // destroy() when done with it, or replaced with a fresh one, before
  // starting a new load against the same shared worker. Confirmed by hand:
  // without this, calling getDocument() again for page 2 while page 1's
  // document was never destroyed made rendering fail outright.
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!isPdf) {
      setPdfDoc(null);
      return;
    }
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;
    pdfjsLib.getDocument(fileUrlRef.current).promise.then((doc) => {
      if (cancelled) {
        doc.destroy();
        return;
      }
      loaded = doc;
      setPdfDoc(doc);
      onNumPages?.(doc.numPages);
    }).catch(() => {
      if (!cancelled) setError('Could not load this drawing.');
    });
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableUrlKey, isPdf]);

  useEffect(() => {
    let cancelled = false;
    // Holds this invocation's in-flight pdf.js render task so cleanup can
    // actually cancel it -- setting the `cancelled` flag alone stops this
    // invocation's OWN subsequent awaits from acting on a stale result,
    // but does nothing to stop the real, already-started render() call
    // against the canvas. Deliberately a plain local variable (like
    // `cancelled` itself), NOT a ref: a ref is shared across every
    // invocation of this effect, so if two invocations briefly overlap
    // (React StrictMode's dev-mode double-invoke, or fast repeated page
    // navigation queuing up quicker than each render finishes), the
    // second invocation's task can silently overwrite the first's in a
    // shared ref -- the first task then never gets cancelled at all.
    // Confirmed by hand: that exact bug (an earlier, ref-based version of
    // this fix) still reproduced "Cannot use the same canvas during
    // multiple render() operations" on repeated back-and-forth page
    // navigation, because cleanup was cancelling the wrong invocation's
    // task.
    let currentRenderTask: ReturnType<pdfjsLib.PDFPageProxy['render']> | null = null;

    async function render() {
      try {
        const currentUrl = fileUrlRef.current;
        if (isPdf) {
          if (!pdfDoc) return; // document load effect hasn't resolved yet
          const pageNum = Math.min(Math.max(1, page), pdfDoc.numPages);
          const pdfPage = await pdfDoc.getPage(pageNum);
          if (cancelled) return;
          const containerWidth = containerRef.current?.clientWidth ?? 900;
          const baseViewport = pdfPage.getViewport({ scale: 1 });
          const scale = containerWidth / baseViewport.width;
          const viewport = pdfPage.getViewport({ scale });
          const canvas = canvasRef.current;
          if (!canvas || cancelled) return;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          // Setting canvas.width/height only clears the canvas when the
          // value actually changes -- if a page re-renders at the same
          // pixel size as a previous (possibly cancelled) attempt, that
          // implicit clear never happens and the new render's pixels
          // composite on top of whatever was already painted, producing a
          // garbled double-exposure. Confirmed by hand: repeated/overlapping
          // render attempts against a same-size canvas left visibly
          // corrupted output. Clear explicitly so every render starts from
          // a blank canvas regardless of whether the size changed.
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // Some CAD-exported PDFs (many hundreds of content streams / form
          // XObjects for a single page) take pdf.js's canvas renderer an
          // impractically long time to rasterize -- confirmed against a real
          // file that hadn't finished after 60+ seconds. Rather than hang
          // silently forever, cancel and surface a clear message.
          const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
          currentRenderTask = renderTask;
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => {
              renderTask.cancel();
              reject(new Error('RENDER_TIMEOUT'));
            }, 20000);
          });
          await Promise.race([renderTask.promise, timeout]);
          if (!cancelled) setSize({ width: viewport.width, height: viewport.height });
        } else {
          const img = new Image();
          img.onload = () => {
            if (cancelled) return;
            const canvas = canvasRef.current;
            const containerWidth = containerRef.current?.clientWidth ?? 900;
            const scale = containerWidth / img.width;
            const w = img.width * scale;
            const h = img.height * scale;
            if (!canvas) return;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, w, h);
            setSize({ width: w, height: h });
          };
          img.onerror = () => setError('Could not load drawing image.');
          img.src = currentUrl;
        }
      } catch (err) {
        // A cancelled render rejects renderTask.promise with a
        // RenderingCancelledException. This is expected, not a failure --
        // it fires whenever a newer render supersedes an older one -- so
        // it's checked by name/constructor here rather than relying only
        // on the `cancelled` flag: pdf.js's own cancellation is
        // asynchronous internally, so a render started just before
        // cleanup can still get cancelled out from under an invocation
        // whose `cancelled` flag hasn't flipped yet by the time the
        // rejection is caught. Confirmed by hand: without this check,
        // ordinary fast back-and-forth page navigation intermittently
        // showed "Could not render this drawing" even though the actual
        // most-recent render succeeded fine right after.
        const isCancellation = err instanceof Error && err.name === 'RenderingCancelledException';
        if (!cancelled && !isCancellation) {
          // Log the real cause -- this catch previously swallowed it
          // entirely, which is exactly why the underlying render-task-
          // cancellation bug (see above) took hands-on live debugging to
          // even find, instead of a two-second console check.
          console.error('DrawingViewer render failed:', err);
          setError(
            err instanceof Error && err.message === 'RENDER_TIMEOUT'
              ? 'This drawing is too complex to preview in the browser (took too long to render). Try exporting a simpler or flattened PDF, or an image instead.'
              : 'Could not render this drawing.',
          );
        }
      }
    }
    render();
    return () => {
      cancelled = true;
      // Actually stop any in-flight render() against the canvas -- not
      // just flagging it stale (see currentRenderTask comment above).
      currentRenderTask?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableUrlKey, isPdf, page, pdfDoc]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placingMode || !onPlacePin || !size) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.height;
    onPlacePin(xNorm, yNorm);
  }

  return (
    <div ref={containerRef} className="w-full overflow-auto bg-base-900 rounded">
      {error && <div className="p-6 text-sm text-danger">{error}</div>}
      <div
        className={`relative inline-block ${placingMode ? 'cursor-crosshair' : ''}`}
        onClick={handleClick}
        style={size ? { width: size.width, height: size.height } : undefined}
      >
        <canvas ref={canvasRef} className="block" />
        {size && (
          <svg className="absolute inset-0 pointer-events-none" width={size.width} height={size.height}>
            {pins.map((pin) => (
              <g
                key={pin.locationId}
                transform={`translate(${pin.posXNorm * size.width}, ${pin.posYNorm * size.height})`}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinClick?.(pin);
                }}
              >
                {pin.captureCount > 0 ? (
                  <>
                    <circle r="9" className="fill-signal stroke-signal-hover" strokeWidth="2" />
                    <circle r="3" className="fill-base-950" />
                  </>
                ) : (
                  // No media yet -- a hollow marker so an empty, just-created
                  // pin reads visually differently from one with a history.
                  <circle r="9" className="fill-base-950/60 stroke-signal" strokeWidth="2" strokeDasharray="2.5 2" />
                )}
                {pin.compassHeadingDeg !== undefined && (
                  <line
                    x1="0" y1="0"
                    x2={9 * Math.sin(degToRad(pin.compassHeadingDeg))}
                    y2={-9 * Math.cos(degToRad(pin.compassHeadingDeg))}
                    className="stroke-signal-hover"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}
