import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

// `to` omitted on the last crumb marks the current page (not a link,
// aria-current="page") -- callers don't need to remember to drop the href
// themselves, same convention PageHeader's eyebrow already implies.
export function Breadcrumbs({ items, className = '' }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1.5 text-xs text-ink-500 ${className}`}>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5 min-w-0">
          {i > 0 && <span aria-hidden="true">/</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-ink-100 transition-colors truncate">{item.label}</Link>
          ) : (
            <span aria-current="page" className="text-ink-300 truncate">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
