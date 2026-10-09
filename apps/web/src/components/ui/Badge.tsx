import type { ReactNode } from 'react';
import type { StatusTone } from '../../lib/status-tone';
import { TONE_CLASS, TONE_DOT_CLASS } from '../../lib/status-tone';

// Generic badge -- a plain labeled pill with no status semantics (e.g. a
// location tag, a discipline tag). For anything representing a real status/
// priority/lifecycle value, use StatusBadge below instead so it picks up
// the shared tone vocabulary rather than an ad-hoc color.
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`badge bg-base-700 text-ink-500 ${className}`}>{children}</span>;
}

export function StatusBadge({ tone, label, dot = false }: { tone: StatusTone; label: string; dot?: boolean }) {
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT_CLASS[tone]}`} />}
      {label}
    </span>
  );
}
