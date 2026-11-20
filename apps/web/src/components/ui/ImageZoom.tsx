import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../lib/use-dialog';

// A full-screen look at one image: centred, fitted to the visible screen
// (dvh, so phone browser bars don't crop it); click, tap or Escape closes.
export function ImageZoom({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(Boolean(src), onClose, ref);
  if (!src) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
      onClick={onClose}
      className="dialog-backdrop-in fixed inset-0 z-[80] flex items-center justify-center p-4 bg-base-950/90 backdrop-blur-sm cursor-zoom-out focus:outline-none"
    >
      <img src={src} alt={alt} className="dialog-in max-w-full max-h-[calc(100dvh-2rem)] rounded-lg shadow-xl object-contain" />
    </div>,
    document.body,
  );
}
