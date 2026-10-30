import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';

// On a phone, a long report or detail section folds down to one row: its
// title plus a one-line summary, opened on tap. On desktop the section
// renders exactly as before -- the fold only exists below the md
// breakpoint, where stacking every tile, chart and table made pages run
// to ten screens.
//
// While open, the fold's own button already names the section, so
// SectionHeader (via useInsideMobileFold) drops its duplicate title and
// keeps only its actions.
const FoldContext = createContext(false);
export const useInsideMobileFold = () => useContext(FoldContext);

export function MobileFold({ title, summary, children }: {
  title: string;
  /** One line that says what's inside, e.g. "8 issues · 2 critical". */
  summary?: string;
  children: ReactNode;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (desktop) return <>{children}</>;
  return (
    <section className="panel">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-4 py-4 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-ink-100 tracking-tight">{title}</span>
          {summary && <span className="block text-xs text-ink-500 mt-0">{summary}</span>}
        </span>
        <svg
          viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"
          className={`w-4 h-4 text-ink-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={bodyId} className="mobile-fold-body px-4 pb-4">
          <FoldContext.Provider value>{children}</FoldContext.Provider>
        </div>
      )}
    </section>
  );
}
