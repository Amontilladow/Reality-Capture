import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../lib/use-dialog';

// Every popup window in the app. Rendered at the top of the page (a portal),
// so a parent with a blur or transform can never push it off-centre or under
// the sidebar; always centred in the visible screen (dvh, so a phone's
// browser bars don't cut it), its body scrolls when it is taller than the
// screen, and it follows the light/dark theme tokens. Escape, focus and
// scroll handling come from useDialog.
export function Modal({
  open, onClose, title, children, wide,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(open, onClose, panelRef);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6">
      <div className="dialog-backdrop-in absolute inset-0 bg-base-950/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`dialog-in relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[calc(100dvh-2rem)] sm:max-h-[min(85dvh,calc(100dvh-3rem))] rounded-2xl border border-ink-100/10 bg-base-800 text-ink-100 shadow-xl overflow-hidden flex flex-col focus:outline-none`}
      >
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 shrink-0 border-b border-ink-100/10">
          <h3 id={titleId} className="text-base font-semibold min-w-0 truncate">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 -mr-2 shrink-0 grid place-items-center rounded-full text-ink-500 hover:text-ink-100 hover:bg-ink-100/10"
            aria-label="Close"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:pb-6 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
