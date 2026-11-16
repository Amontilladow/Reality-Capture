import { forwardRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttentionClass, AttentionItem, CommandCenterSummary } from '../../lib/workspace.api';
import { recordHref, RECORD_LABEL } from '../../lib/record-links';
import { StatusBadge } from '../ui/Badge';
import { Listbox } from '../ui/Listbox';
import type { StatusTone } from '../../lib/status-tone';

const CLASS_LABEL: Record<AttentionClass, string> = { critical: 'Critical', overdue: 'Overdue', due_soon: 'Due soon', pending: 'Pending', info: 'For information' };
const CLASS_TONE: Record<AttentionClass, StatusTone> = { critical: 'critical', overdue: 'danger', due_soon: 'warning', pending: 'info', info: 'neutral' };
const CLASS_BAR: Record<AttentionClass, string> = { critical: 'bg-signal', overdue: 'bg-danger', due_soon: 'bg-warn', pending: 'bg-ink-300', info: 'bg-ink-100/20' };
const TYPES: AttentionItem['type'][] = ['drawing', 'rfi', 'qaqc', 'inspection', 'submittal', 'issue', 'snag'];
const COLLAPSED = 6;

export type AttentionFilter = 'all' | AttentionClass;

// Everything on the project that needs someone, across modules, ranked
// Critical → Overdue → Due soon → Pending → For information. "Overdue" is
// only ever an item with a real due date in the past.
export const AttentionCenter = forwardRef<HTMLElement, {
  projectId: string;
  data?: CommandCenterSummary;
  isLoading: boolean;
  isError: boolean;
  filter: AttentionFilter;
  onFilter: (f: AttentionFilter) => void;
}>(function AttentionCenter({ projectId, data, isLoading, isError, filter, onFilter }, ref) {
  const [type, setType] = useState<'all' | AttentionItem['type']>('all');
  const [expanded, setExpanded] = useState(false);
  const all = data?.attention.items ?? [];
  const items = all.filter((a) => (filter === 'all' || a.class === filter) && (type === 'all' || a.type === type));
  const visible = expanded ? items : items.slice(0, COLLAPSED);
  const counts = data?.attention.counts;
  const presentTypes = TYPES.filter((t) => all.some((a) => a.type === t));

  return (
    <section ref={ref} id="attention" className="panel overflow-hidden scroll-mt-24" aria-labelledby="attention-title">
      <div className="px-6 pt-6 pb-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="attention-title" className="text-base font-semibold text-ink-100">Attention center</h2>
          {presentTypes.length > 1 && (
            <Listbox value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Filter by module" className="field-input !h-10 !w-auto !rounded-full !px-4">
              <option value="all">All modules</option>
              {presentTypes.map((t) => <option key={t} value={t}>{RECORD_LABEL[t]}</option>)}
            </Listbox>
          )}
        </div>
        <div role="tablist" aria-label="Filter by urgency" className="flex flex-wrap gap-2">
          {(['all', 'critical', 'overdue', 'due_soon', 'pending', 'info'] as AttentionFilter[]).map((f) => {
            const n = f === 'all' ? data?.attention.total : counts?.[f];
            const active = filter === f;
            return (
              <button key={f} role="tab" aria-selected={active} type="button" onClick={() => { onFilter(f); setExpanded(false); }}
                className={`h-8 px-4 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-signal text-on-signal border-transparent' : 'border-ink-100/15 text-ink-300 hover:text-ink-100'}`}>
                {f === 'all' ? 'All' : CLASS_LABEL[f]}{n !== undefined ? ` · ${n}` : ''}
              </button>
            );
          })}
        </div>
      </div>
      {isLoading && <p className="px-6 pb-6 text-sm text-ink-500">Loading…</p>}
      {isError && <p className="px-6 pb-6 text-sm text-danger">Couldn't load what needs attention.</p>}
      {!isLoading && !isError && items.length === 0 && (
        <p className="px-6 pb-6 text-sm text-ink-500">{all.length === 0 ? 'Nothing on this project needs attention right now.' : 'Nothing matches this filter.'}</p>
      )}
      {items.length > 0 && (
        <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-2 border-t border-ink-100/10 text-eyebrow font-medium uppercase text-ink-500">
          <span className="col-span-5">Item</span><span className="col-span-2">Responsible</span><span className="col-span-2">Due</span><span className="col-span-2">Status</span><span className="col-span-1" />
        </div>
      )}
      <ul>
        {visible.map((a) => <AttentionRow key={a.key} a={a} projectId={projectId} today={data!.today} />)}
      </ul>
      {items.length > COLLAPSED && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full h-12 border-t border-ink-100/10 text-xs font-medium text-blueprint hover:bg-ink-100/5">
          {expanded ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
});

function AttentionRow({ a, projectId, today }: { a: AttentionItem; projectId: string; today: string }) {
  const href = recordHref(a.type, projectId, a.id, a.recordType);
  const due = a.dueDate ? dueText(a.dueDate, today) : a.since ? `${elapsed(a.since)} ago` : '–';
  return (
    <li className="relative grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-center px-6 py-4 border-t border-ink-100/10">
      <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1 ${CLASS_BAR[a.class]}`} />
      <div className="md:col-span-5 min-w-0">
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <span className="font-medium text-ink-300">{RECORD_LABEL[a.type]}</span>
          {a.reference && <span className="tabular-nums">{a.reference}</span>}
          <span>· {a.label}</span>
        </div>
        {href ? (
          <Link to={href} className="block text-sm font-medium text-ink-100 hover:text-blueprint truncate">{a.title}</Link>
        ) : (
          <span className="block text-sm font-medium text-ink-100 truncate">{a.title}</span>
        )}
      </div>
      <div className="md:col-span-2 text-sm text-ink-300 truncate"><span className="md:hidden text-xs text-ink-500">Responsible: </span>{a.responsible ?? 'Unassigned'}</div>
      <div className={`md:col-span-2 text-sm tabular-nums ${a.class === 'overdue' ? 'text-danger font-medium' : 'text-ink-300'}`}>
        <span className="md:hidden text-xs text-ink-500">{a.dueDate ? 'Due: ' : 'Waiting: '}</span>{due}
      </div>
      <div className="md:col-span-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone={CLASS_TONE[a.class]} label={CLASS_LABEL[a.class]} />
        <span className="text-xs text-ink-500">{a.status.replace(/_/g, ' ').toLowerCase()}</span>
      </div>
      <div className="md:col-span-1 md:text-right">
        {href && <Link to={href} className="text-xs font-medium text-blueprint hover:text-blueprint-hover">Open</Link>}
      </div>
    </li>
  );
}

function dueText(date: string, today: string) {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function elapsed(iso: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
