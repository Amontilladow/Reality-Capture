import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchEverything, type SearchResult } from '../../lib/workspace.api';
import { recordHref, RECORD_LABEL } from '../../lib/record-links';
import { OPEN_SEARCH_EVENT } from '../../lib/global-search';

// One search box for projects, drawings, issues, RFIs, QA/QC, snags,
// people, and the user's own tasks and saved items. Opens with Ctrl/⌘+K
// or the Search button; results come from the API, scoped to what the
// user may see.
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else { setQ(''); setDebounced(''); }
  }, [open]);

  const query = useQuery({
    queryKey: ['me', 'search', debounced],
    queryFn: () => searchEverything(debounced),
    enabled: open && debounced.length >= 2,
    placeholderData: (prev) => prev,
  });
  const results = (debounced.length >= 2 ? query.data?.results : []) ?? [];
  const linkable = results.map((r) => ({ r, href: hrefFor(r) })).filter((x): x is { r: SearchResult; href: string } => Boolean(x.href));
  useEffect(() => setActive(0), [debounced]);

  if (!open) return null;
  const go = (href: string) => { setOpen(false); navigate(href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, linkable.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && linkable[active]) { e.preventDefault(); go(linkable[active].href); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-24" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-base-950/80 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="relative w-full max-w-2xl rounded-2xl border border-ink-100/10 bg-base-800 shadow-xl overflow-hidden" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-4 px-4 border-b border-ink-100/10">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search drawings, issues, RFIs, QA/QC, snags, people, your tasks…"
            aria-label="Search"
            role="combobox"
            aria-expanded={linkable.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={linkable[active] ? `gs-${active}` : undefined}
            className="flex-1 h-14 bg-transparent text-base text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          <kbd className="text-xs text-ink-500">Esc</kbd>
        </div>
        <div id="global-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-2">
          {debounced.length < 2 && <p className="px-4 py-4 text-sm text-ink-500">Type at least two letters.</p>}
          {debounced.length >= 2 && query.isLoading && <p className="px-4 py-4 text-sm text-ink-500">Searching…</p>}
          {debounced.length >= 2 && query.isError && <p className="px-4 py-4 text-sm text-danger">Search failed. Try again.</p>}
          {debounced.length >= 2 && query.isSuccess && linkable.length === 0 && <p className="px-4 py-4 text-sm text-ink-500">No matches for “{debounced}”.</p>}
          {linkable.map(({ r, href }, i) => (
            <button
              key={`${r.type}:${r.id}`}
              id={`gs-${i}`}
              role="option"
              aria-selected={i === active}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(href)}
              className={`w-full flex items-center gap-4 px-4 py-2 text-left ${i === active ? 'bg-ink-100/10' : ''}`}
            >
              <span className="w-20 shrink-0 text-xs font-medium text-ink-500">{RECORD_LABEL[r.type === 'saved' ? r.recordType ?? 'saved' : r.type]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink-100 truncate">{r.reference && r.type !== 'saved' && r.type !== 'user' ? `${r.reference} · ` : ''}{r.title}</span>
                {(r.projectName || r.type === 'user') && <span className="block text-xs text-ink-500 truncate">{r.type === 'user' ? r.reference : r.projectName}</span>}
              </span>
              {r.type === 'saved' && <span className="text-xs text-ink-500">Saved</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function hrefFor(r: SearchResult): string | null {
  if (r.type === 'user') return '/projects/messages';
  if (r.type === 'saved') return recordHref(r.recordType ?? '', r.projectId, r.id);
  return recordHref(r.type, r.projectId, r.id, r.recordType);
}
