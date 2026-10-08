import { useId, useState } from 'react';
import type { ReactNode } from 'react';

// Minimal hover/focus tooltip -- no positioning library, since a simple
// "always above, centered" placement covers every current use case (an
// icon-only button's accessible name, a truncated value's full text). If a
// future caller needs edge-aware flipping, that's the point to reach for a
// real positioning dependency, not to grow this file speculatively now.
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded text-xs font-medium bg-base-700 text-ink-100 border border-base-500 whitespace-nowrap z-20 pointer-events-none"
        >
          {label}
        </span>
      )}
    </span>
  );
}
