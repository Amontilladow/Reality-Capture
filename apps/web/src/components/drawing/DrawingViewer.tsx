import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FloorPlanPin } from '../../lib/drawings.api';

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
  pins: FloorPlanPin[];
  placingMode?: boolean;
  onPlacePin?: (xNorm: number, yNorm: number) => void;
  onPinClick?: (pin: FloorPlanPin) => void;
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
          await page.render({ canvasContext: ctx, viewport }).promise;
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
      } catch {
        if (!cancelled) setError('Could not render this drawing.');
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
                key={pin.captureId}
                transform={`translate(${pin.posXNorm * size.width}, ${pin.posYNorm * size.height})`}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinClick?.(pin);
                }}
              >
                <circle r="9" className="fill-signal stroke-signal-hover" strokeWidth="2" />
                <circle r="3" className="fill-base-950" />
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
