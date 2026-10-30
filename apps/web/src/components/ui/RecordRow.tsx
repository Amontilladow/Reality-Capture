import type { ReactNode } from 'react';

// The phone layout for a register of records (issues, risks, ...): one
// grouped panel with hairline dividers and dense two-line rows, the way
// field apps list work -- rather than a stack of separate cards, each
// repeating every label and badge on its own line.
//
// A row reads left to right: a severity marker, the title (what it is),
// one quiet line of context (code · priority · discipline), and on the
// right what needs acting on (due) and who owns it.
export function RecordList({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="panel overflow-hidden divide-y divide-base-600/60">
      {children}
    </ul>
  );
}

export function RecordRow({
  marker, lead, title, meta, due, dueTone = 'muted', owner, onClick,
}: {
  /** Tailwind bg-* class for the 4px severity bar (ignored when `lead` is set). */
  marker?: string;
  /** Replaces the bar with a block, e.g. a risk's score. */
  lead?: ReactNode;
  title: string;
  /** One line of context; severity must also be named here, not only coloured. */
  meta: string;
  due?: string;
  dueTone?: 'muted' | 'warn' | 'danger' | 'ok';
  /** Owner's display name; omitted means unassigned. */
  owner?: string;
  onClick: () => void;
}) {
  const dueClass = { muted: 'text-ink-500', warn: 'text-warn font-medium', danger: 'text-danger font-medium', ok: 'text-ink-300' }[dueTone];
  return (
    <li>
      <button type="button" onClick={onClick} className="w-full flex items-center gap-4 px-4 py-4 text-left hover:bg-base-700 transition-colors">
        {lead ?? <span aria-hidden="true" className={`w-1 self-stretch rounded-full shrink-0 ${marker ?? 'bg-base-600'}`} />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-ink-100 leading-snug line-clamp-2">{title}</span>
          <span className="block text-xs text-ink-500 truncate mt-0">{meta}</span>
        </span>
        <span className="shrink-0 flex flex-col items-end gap-2">
          {due && <span className={`text-xs tabular-nums ${dueClass}`}>{due}</span>}
          <Initials name={owner} />
        </span>
      </button>
    </li>
  );
}

/** Owner initials in a small circle; a dashed empty circle when unassigned. */
export function Initials({ name }: { name?: string }) {
  if (!name) {
    return <span role="img" aria-label="Unassigned" className="w-6 h-6 rounded-full border border-dashed border-ink-500/60 shrink-0" />;
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return (
    <span role="img" aria-label={`Assigned to ${name}`} className="w-6 h-6 rounded-full bg-base-600 text-ink-100 text-xs font-semibold flex items-center justify-center shrink-0">
      {initials}
    </span>
  );
}
