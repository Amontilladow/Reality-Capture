// Numbered pagination for any list backed by DatabaseService.paginate()'s
// {page, pageSize, total} shape (apps/api/src/database/database.service.ts)
// -- the API contract already returns exactly this, nothing new needed
// there. Collapses long ranges with an ellipsis rather than rendering every
// page number, which tables with hundreds of pages would otherwise do.
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const pages = visiblePages(page, pageCount);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 text-sm">
      <span className="text-ink-500">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PageButton label="Previous" disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        {pages.map((p, i) =>
          p === null ? (
            <span key={`ellipsis-${i}`} className="px-2 text-ink-500">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`w-8 h-8 rounded text-sm transition-colors ${
                p === page ? 'bg-signal text-base-950 font-medium' : 'text-ink-300 hover:bg-base-800'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <PageButton label="Next" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} />
      </div>
    </nav>
  );
}

function PageButton({ label, disabled, onClick }: { label: 'Previous' | 'Next'; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="w-8 h-8 rounded text-ink-300 hover:bg-base-800 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {label === 'Previous' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  );
}

// Always shows first, last, current ±1, collapsing the rest into a single
// null (ellipsis) entry on each side once there's a gap to collapse.
function visiblePages(current: number, count: number): (number | null)[] {
  const pages: (number | null)[] = [];
  for (let p = 1; p <= count; p++) {
    if (p === 1 || p === count || Math.abs(p - current) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== null) {
      pages.push(null);
    }
  }
  return pages;
}
