// Where a record lives in the app, from its type and ids. One place, so
// every list (priorities, attention, calendar, search, saved items) links
// to the same page for the same record.
export function recordHref(type: string, projectId: string | null | undefined, id: string, recordType?: string | null): string | null {
  if (type === 'project') return `/projects/${id}`;
  if (type === 'task' || type === 'reminder') return `/projects/my-tasks?task=${id}`;
  if (type === 'user') return null;
  if (!projectId) return null;
  const base = `/projects/${projectId}`;
  switch (type) {
    case 'issue': return `${base}/issues?issueId=${id}`;
    case 'rfi': return `${base}/rfis/${id}`;
    case 'snag': return `${base}/snagging?snagId=${id}`;
    case 'qaqc': return recordType ? `${base}/qaqc/${recordType}/${id}` : `${base}/qaqc`;
    case 'submittal': return `${base}/submittals`;
    case 'inspection': return `${base}/qa-inspections`;
    case 'drawing': return `${base}/site-drawings`;
    default: return null;
  }
}

export const RECORD_LABEL: Record<string, string> = {
  task: 'My task', reminder: 'Reminder', issue: 'Issue', rfi: 'RFI', snag: 'Snag', qaqc: 'QA/QC', submittal: 'Submittal',
  inspection: 'Inspection', drawing: 'Drawing', project: 'Project', user: 'Person', saved: 'Saved', event: 'Meeting',
};

/** "Today, 3:00 PM", "Tomorrow", "Overdue by 2 days", "Fri 21 Nov". */
export function dueLabel(dueDate: string | null, dueTime: string | null, today: string, hour12?: boolean): string {
  if (!dueDate) return 'No due date';
  const diff = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const time = dueTime ? formatTime(dueTime, hour12) : '';
  if (diff < 0) return `Overdue by ${-diff} ${diff === -1 ? 'day' : 'days'}`;
  if (diff === 0) return time ? `Today, ${time}` : 'Today';
  if (diff === 1) return time ? `Tomorrow, ${time}` : 'Tomorrow';
  const d = new Date(`${dueDate}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return time ? `${d}, ${time}` : d;
}

export function formatTime(hhmm: string, hour12?: boolean): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12, timeZone: 'UTC' });
}
