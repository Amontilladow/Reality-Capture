import type { ReactNode } from 'react';

export function Modal({
  open, onClose, title, children, wide,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-base-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[85vh] tick-frame panel overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between px-6 pt-6 pb-5 shrink-0">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-100" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
