import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: string;
  badge?: number;
}

// Accessible tab list (role="tablist"/"tab", roving tabindex, arrow-key
// navigation) rendering only the strip itself -- the caller still owns
// which panel is shown for `active`, same as every page that already
// hand-rolls a "Tab" union + button row (IssuesPage, SnaggingPage, etc.)
// does today. This replaces that button row, not the panel-switching logic.
export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusIndex(i: number) {
    const key = items[i]?.key;
    if (key) refs.current[key]?.focus();
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    if (e.key === 'ArrowRight') { e.preventDefault(); focusIndex((i + 1) % items.length); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusIndex((i - 1 + items.length) % items.length); }
    else if (e.key === 'Home') { e.preventDefault(); focusIndex(0); }
    else if (e.key === 'End') { e.preventDefault(); focusIndex(items.length - 1); }
  }

  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-base-600">
      {items.map((item, i) => {
        const selected = item.key === active;
        return (
          <button
            key={item.key}
            ref={(el) => { refs.current[item.key] = el; }}
            role="tab"
            id={`tab-${item.key}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onChange(item.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              selected
                ? 'border-signal text-ink-100'
                : 'border-transparent text-ink-500 hover:text-ink-300'
            }`}
          >
            {item.label}
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span className="ml-2 badge bg-base-700 text-ink-500">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Wraps a tab's content with the matching ARIA attributes -- pairs with the
// `id`/`aria-controls` above. Pass through unconditionally (don't unmount
// inactive panels) when a panel holds state (form input, scroll position)
// that should survive switching tabs and back.
export function TabPanel({ tabKey, active, children }: { tabKey: string; active: string; children: ReactNode }) {
  if (tabKey !== active) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${tabKey}`} aria-labelledby={`tab-${tabKey}`}>
      {children}
    </div>
  );
}
