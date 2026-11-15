import type { ReactNode } from 'react';

// A panel whose body opens on demand: secondary information stays one
// line (its title, a count and a short summary) until someone asks for it.
// Built on <details>, so it works with the keyboard and screen readers out
// of the box.
export function Collapsible({
  title,
  count,
  summary,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number | string;
  summary?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="panel overflow-hidden group" open={defaultOpen || undefined}>
      <summary className="flex items-center gap-4 px-6 py-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        {icon && <span className="nav-tile">{icon}</span>}
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-ink-100">
            {title}
            {count !== undefined && <span className="ml-2 text-xs font-normal text-ink-500">{count}</span>}
          </span>
          {summary && <span className="block text-xs text-ink-500 truncate">{summary}</span>}
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5 text-ink-300 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="px-6 pb-6">{children}</div>
    </details>
  );
}
