import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Pin } from '../../lib/drawings.api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;



export function DrawingViewer({
  fileUrl,
  isPdf,
  pins,
  placingMode,
  onPlacePin,
  onPinClick,
}: {
  fileUrl: string;
  isPdf: boolean;
  pins: Pin[];
  placingMode?: boolean;
  onPlacePin?: (xNorm: number, yNorm: number) => void;
  onPinClick?: (pin: Pin) => void;
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

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const currentUrl = fileUrlRef.current;
        if (isPdf) {
          const doc = await pdfjsLib.getDocument(currentUrl).promise;
          const page = await doc.getPage(1);
          const containerWidth = containerRef.current?.clientWidth ?? 900;
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });
          const canvas = canvasRef.current;
          if (!canvas || cancelled) return;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          // Some CAD-exported PDFs (many hundreds of content streams / form
          // XObjects for a single page) take pdf.js's canvas renderer an
          // impractically long time to rasterize -- confirmed against a real
          // file that hadn't finished after 60+ seconds. Rather than hang
          // silently forever, cancel and surface a clear message.
          const renderTask = page.render({ canvasContext: ctx, viewport });
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
        if (!cancelled) {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableUrlKey, isPdf]);

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
