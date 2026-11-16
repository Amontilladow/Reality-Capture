// Rule-based daily priorities and attention classification. Pure functions
// (no database, no clock of their own) so every rule is unit-tested in
// priority-rules.spec.ts and the numbers can be explained to a user.
//
// Score, highest first (documented in docs/command-center-plan.md):
//   overdue          100 + days overdue (capped at +30)
//   due today         80
//   due tomorrow      60
//   due within 7 days 40
//   later             20
//   no due date       10
//   priority          critical +30, high +20, medium +10, low 0
//   awaiting me       +15 (an RFI waiting on my answer, an item waiting on my verification)

export type WorkSource = 'task' | 'reminder' | 'issue' | 'rfi' | 'snag' | 'qaqc' | 'submittal' | 'inspection';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface WorkItem {
  source: WorkSource;
  id: string;
  projectId: string | null;
  projectName: string | null;
  reference: string | null;
  title: string;
  status: string;
  priority: Priority | null;
  /** Due date in the user's own timezone, YYYY-MM-DD. */
  dueDate: string | null;
  /** Wall-clock due time in the user's timezone, HH:MM, when the record has one. */
  dueTime: string | null;
  /** Why this item is the user's: assigned to them, their own task, or waiting on them. */
  relation: 'assigned' | 'own' | 'awaiting_review' | 'awaiting_response';
  /** For QA/QC records: the record type used in the link (ncr, sor, wir, mir). */
  recordType?: string | null;
}

export interface RankedItem extends WorkItem {
  score: number;
  dueState: 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'none';
  daysOverdue: number;
  reason: string;
  nextAction: string;
}

const PRIORITY_POINTS: Record<Priority, number> = { critical: 30, high: 20, medium: 10, low: 0 };

/** Whole days from a to b, both YYYY-MM-DD (b - a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function dueState(item: Pick<WorkItem, 'dueDate' | 'dueTime'>, today: string, nowTime: string): { state: RankedItem['dueState']; daysOverdue: number } {
  if (!item.dueDate) return { state: 'none', daysOverdue: 0 };
  const diff = dayDiff(today, item.dueDate);
  if (diff < 0) return { state: 'overdue', daysOverdue: -diff };
  if (diff === 0) {
    // Due today with a time already passed is overdue (by 0 whole days).
    if (item.dueTime && item.dueTime < nowTime) return { state: 'overdue', daysOverdue: 0 };
    return { state: 'today', daysOverdue: 0 };
  }
  if (diff === 1) return { state: 'tomorrow', daysOverdue: 0 };
  if (diff <= 7) return { state: 'this_week', daysOverdue: 0 };
  return { state: 'later', daysOverdue: 0 };
}

const SOURCE_LABEL: Record<WorkSource, string> = {
  task: 'Personal task', reminder: 'Reminder', issue: 'Issue', rfi: 'RFI', snag: 'Snag', qaqc: 'QA/QC record', submittal: 'Submittal', inspection: 'Inspection',
};

function reasonFor(item: WorkItem, state: RankedItem['dueState'], daysOverdue: number): string {
  const parts: string[] = [];
  if (state === 'overdue') parts.push(daysOverdue === 0 ? 'overdue since earlier today' : `overdue by ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'}`);
  else if (state === 'today') parts.push(item.source === 'inspection' ? 'inspection scheduled today' : 'due today');
  else if (state === 'tomorrow') parts.push('due tomorrow');
  else if (state === 'this_week') parts.push('due this week');
  if (item.priority === 'critical') parts.unshift('critical');
  else if (item.priority === 'high' && state !== 'none') parts.unshift('high priority');
  if (item.relation === 'awaiting_response') parts.push('waiting on your answer');
  if (item.relation === 'awaiting_review') parts.push('waiting on your verification');
  if (parts.length === 0) return `${SOURCE_LABEL[item.source]} with no due date`;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nextActionFor(item: WorkItem): string {
  if (item.relation === 'awaiting_response') return 'Write and send your answer';
  if (item.relation === 'awaiting_review') return item.source === 'snag' ? 'Check the fix on site and verify it' : 'Review the work and close it or send it back';
  switch (item.source) {
    case 'task': return item.status === 'in_progress' ? 'Finish it and mark it done' : 'Start it';
    case 'reminder': return 'Act on the reminder, then mark it done';
    case 'issue': return item.status === 'in_progress' ? 'Finish the fix and mark it resolved' : 'Start work and update the status';
    case 'rfi': return 'Write and send your answer';
    case 'snag': return 'Fix it and mark it fixed';
    case 'qaqc': return 'Respond to the record';
    case 'submittal': return 'Review the submittal and record a decision';
    case 'inspection': return 'Carry out the inspection and record the result';
  }
}

export function scoreItem(item: WorkItem, today: string, nowTime: string): RankedItem {
  const { state, daysOverdue } = dueState(item, today, nowTime);
  const timing = state === 'overdue' ? 100 + Math.min(daysOverdue, 30)
    : state === 'today' ? 80
    : state === 'tomorrow' ? 60
    : state === 'this_week' ? 40
    : state === 'later' ? 20
    : 10;
  const score = timing
    + (item.priority ? PRIORITY_POINTS[item.priority] : 0)
    + (item.relation === 'awaiting_response' || item.relation === 'awaiting_review' ? 15 : 0);
  return { ...item, score, dueState: state, daysOverdue, reason: reasonFor(item, state, daysOverdue), nextAction: nextActionFor(item) };
}

/** Highest score first; ties go to the earlier due date, then the earlier due time. */
export function rankItems(items: WorkItem[], today: string, nowTime: string): RankedItem[] {
  return items
    .map((i) => scoreItem(i, today, nowTime))
    .sort((a, b) =>
      b.score - a.score
      || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
      || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'));
}

// ── Attention center classification ────────────────────────────────────────

export type AttentionClass = 'critical' | 'overdue' | 'due_soon' | 'pending' | 'info';

/**
 * Overdue needs a real due date in the past; an item without one is never
 * called overdue. Critical priority wins over everything else; "due soon"
 * is within the next 3 days.
 */
export function classifyAttention(input: { priority: string | null; dueDate: string | null; informational?: boolean }, today: string): AttentionClass {
  if (input.informational) return 'info';
  if (input.priority === 'critical') return 'critical';
  if (input.dueDate) {
    const diff = dayDiff(today, input.dueDate);
    if (diff < 0) return 'overdue';
    if (diff <= 3) return 'due_soon';
  }
  return 'pending';
}

export const ATTENTION_ORDER: Record<AttentionClass, number> = { critical: 0, overdue: 1, due_soon: 2, pending: 3, info: 4 };

// ── Time zones ─────────────────────────────────────────────────────────────

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's date (YYYY-MM-DD) and wall-clock time (HH:MM) in a timezone. */
export function localNow(tz: string, now: Date = new Date()): { today: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { today: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The UTC instant of local midnight at the start of `date` (YYYY-MM-DD) in `tz`; DST-safe. */
export function zonedMidnightUtc(date: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, 0, 0);
  let guess = target;
  // Two passes settle any offset, including a DST change on that day.
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
    );
    const asLocal = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    guess += target - asLocal;
  }
  return new Date(guess);
}
