import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { PageHeader } from '../components/layout/PageHeader';
import { IssueFormModal } from '../components/issues/IssueFormModal';
import { IssueDetail } from '../components/issues/IssueDetail';
import {
  listIssues, getIssueSummary, bulkCloseIssues, listReminders, broadcastReminder, sendUserReminder, warnUser,
  type IssueListItem, type IssueDetailItem,
} from '../lib/issues.api';
import { getMembers, getHierarchy } from '../lib/projects.api';
import { useAuthStore } from '../store/auth.store';
import {
  STATUS_LABELS, STATUS_BADGE_CLASS, PRIORITY_LABELS, PRIORITY_BADGE_CLASS,
  ISSUE_STATUSES, ISSUE_TYPE_LABELS, DISCIPLINE_LABELS, CATEGORY_LABELS,
  isOverdue, formatDeadline, formatDateTime, getDeadlineTimer, TIMER_BADGE_CLASS, isIssueManager,
} from '../lib/issue-constants';
import { apiErrorMessage } from '../lib/api';

type QuickFilter = 'all' | 'overdue' | 'critical' | 'mine';
type Tab = 'issues' | 'dashboard' | 'reminders';

export default function IssuesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isManager = isIssueManager(currentUser?.companyRole);

  const [tab, setTab] = useState<Tab>('issues');
  const [status, setStatus] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editIssue, setEditIssue] = useState<IssueDetailItem | null>(null);
  const [viewIssueId, setViewIssueId] = useState<string | null>(searchParams.get('issueId'));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const summaryQuery = useQuery({
    queryKey: ['issue-summary', projectId],
    queryFn: () => getIssueSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const issuesQuery = useQuery({
    queryKey: ['issues', projectId, status, quickFilter, search, assignedTo, discipline, dateFrom, dateTo],
    queryFn: () =>
      listIssues(projectId!, {
        perPage: 100,
        status: status || undefined,
        priority: quickFilter === 'critical' ? 'critical' : undefined,
        overdue: quickFilter === 'overdue' ? true : undefined,
        myIssues: quickFilter === 'mine' ? true : undefined,
        search: search || undefined,
        assignedTo: assignedTo || undefined,
        discipline: discipline || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
      }),
    enabled: Boolean(projectId),
  });

  // Dashboard needs the full (unfiltered) project issue set to compute the
  // per-user KPI table and status/priority breakdown client-side — there's
  // no dedicated backend aggregate endpoint for those (only getSummary(),
  // which is project-wide totals, not per-user). Capped at 100 rows by the
  // backend's own perPage clamp (issues.service.ts findAll(): `Math.min(
  // query.perPage ?? 20, 100)`) — see the "Deviations" note in the final
  // report for projects with more than 100 issues.
  const dashboardIssuesQuery = useQuery({
    queryKey: ['issues-dashboard', projectId],
    queryFn: () => listIssues(projectId!, { perPage: 100 }),
    enabled: Boolean(projectId) && isManager && tab === 'dashboard',
  });

  const remindersQuery = useQuery({
    queryKey: ['issue-reminders', projectId],
    queryFn: () => listReminders(projectId!, { perPage: 50 }),
    enabled: Boolean(projectId) && tab === 'reminders',
  });

  const bulkCloseMutation = useMutation({
    mutationFn: () => bulkCloseIssues(projectId!, [...selectedIds]),
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issues-dashboard', projectId] });
    },
  });

  const advancedActive = Boolean(assignedTo || discipline || dateFrom || dateTo);
  function clearAdvanced() {
    setAssignedTo('');
    setDiscipline('');
    setDateFrom('');
    setDateTo('');
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const rows = issuesQuery.data?.data ?? [];
    setSelectedIds((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function handleExport() {
    const rows = issuesQuery.data?.data ?? [];
    exportIssuesToExcel(rows);
  }

  if (!projectId) return null;

  if (viewIssueId) {
    return (
      <>
        <PageHeader eyebrow="Project" title="Issue detail" />
        <IssueDetail
          projectId={projectId}
          issueId={viewIssueId}
          onBack={() => setViewIssueId(null)}
          onEdit={(issue) => setEditIssue(issue)}
        />
        {editIssue && (
          <IssueFormModal
            open={Boolean(editIssue)}
            onClose={() => setEditIssue(null)}
            projectId={projectId}
            members={membersQuery.data ?? []}
            hierarchy={hierarchyQuery.data ?? []}
            issue={editIssue}
          />
        )}
      </>
    );
  }

  const s = summaryQuery.data;
  const rows = issuesQuery.data?.data ?? [];
  const allSelected = rows.length > 0 && selectedIds.size === rows.length;

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title="Issues"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleExport} disabled={rows.length === 0} className="btn-secondary">
              <ExportIcon /> Export to Excel
            </button>
            <button onClick={() => setCreateOpen(true)} className="btn-primary">
              <PlusIcon /> New issue
            </button>
          </div>
        }
      />

      <div className="px-6 pt-4 flex items-center gap-1 border-b border-base-600">
        <TabButton active={tab === 'issues'} onClick={() => setTab('issues')}>Issues</TabButton>
        {isManager && <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</TabButton>}
        <TabButton active={tab === 'reminders'} onClick={() => setTab('reminders')}>Reminders</TabButton>
      </div>

      {tab === 'issues' && (
        <div className="p-6 space-y-4">
          {/* Stat tiles */}
          {s && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <StatTile label="Open" value={s.open} onClick={() => { setStatus('open'); setQuickFilter('all'); }} />
              <StatTile label="In Progress" value={s.inProgress} onClick={() => { setStatus(''); setQuickFilter('all'); }} />
              <StatTile label="Resolved" value={s.resolved} onClick={() => { setStatus('resolved'); setQuickFilter('all'); }} />
              <StatTile label="Overdue" value={s.overdue} tone="danger" onClick={() => { setStatus(''); setQuickFilter('overdue'); }} />
              <StatTile label="Critical" value={s.critical} tone="danger" onClick={() => { setStatus(''); setQuickFilter('critical'); }} />
              <StatTile label="Closed" value={s.closed} onClick={() => { setStatus('closed'); setQuickFilter('all'); }} />
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip active={quickFilter === 'all' && !status} onClick={() => { setQuickFilter('all'); setStatus(''); }}>All</FilterChip>
            <FilterChip active={quickFilter === 'mine'} onClick={() => { setQuickFilter('mine'); setStatus(''); }}>My issues</FilterChip>
            <FilterChip active={quickFilter === 'overdue'} onClick={() => { setQuickFilter('overdue'); setStatus(''); }}>Overdue</FilterChip>
            <FilterChip active={quickFilter === 'critical'} onClick={() => { setQuickFilter('critical'); setStatus(''); }}>Critical</FilterChip>

            <select
              className="field-input w-auto ml-auto"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setQuickFilter('all'); }}
            >
              <option value="">All statuses</option>
              {ISSUE_STATUSES.map((st) => (
                <option key={st} value={st}>{STATUS_LABELS[st]}</option>
              ))}
            </select>
            <input
              className="field-input w-48"
              placeholder="Search issues…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`btn-secondary !px-3 !py-1.5 text-xs ${advancedActive ? '!border-signal !text-signal' : ''}`}
            >
              Advanced{advancedActive ? ' •' : ''}
            </button>
          </div>

          {advancedOpen && (
            <div className="panel p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="field-label" htmlFor="fAssignee">Assignee</label>
                <select id="fAssignee" className="field-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">Anyone</option>
                  {(membersQuery.data ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="fDiscipline">Discipline</label>
                <select id="fDiscipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                  <option value="">Any</option>
                  {Object.entries(DISCIPLINE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="fDateFrom">Created from</label>
                <input id="fDateFrom" type="date" className="field-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="field-label" htmlFor="fDateTo">Created to</label>
                  <input id="fDateTo" type="date" className="field-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                {advancedActive && (
                  <button onClick={clearAdvanced} className="btn-ghost !px-2 text-xs shrink-0" title="Clear advanced filters">
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk-select action bar */}
          {rows.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                Select all ({rows.length})
              </label>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 ml-auto panel !py-1.5 !px-3">
                  <span className="text-ink-300">{selectedIds.size} selected</span>
                  <button
                    onClick={() => { if (confirm(`Close ${selectedIds.size} issue(s)?`)) bulkCloseMutation.mutate(); }}
                    disabled={bulkCloseMutation.isPending}
                    className="btn-secondary !px-3 !py-1 text-xs"
                  >
                    {bulkCloseMutation.isPending ? 'Closing…' : 'Bulk close'}
                  </button>
                </div>
              )}
            </div>
          )}
          {bulkCloseMutation.isError && <p className="field-error">{apiErrorMessage(bulkCloseMutation.error)}</p>}
          {bulkCloseMutation.isSuccess && (
            <p className="text-xs text-ok">Closed {bulkCloseMutation.data.closed} issue(s).</p>
          )}

          {/* List */}
          {issuesQuery.isLoading && <p className="text-sm text-ink-500">Loading issues…</p>}
          {issuesQuery.data?.data.length === 0 && (
            <div className="panel p-10 text-center text-sm text-ink-500">No issues match this filter.</div>
          )}
          <div className="space-y-2">
            {rows.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={selectedIds.has(issue.id)}
                onToggleSelect={() => toggleSelect(issue.id)}
                onClick={() => setViewIssueId(issue.id)}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'dashboard' && isManager && (
        <IssueDashboard projectId={projectId!} summary={s} dashboardIssues={dashboardIssuesQuery.data?.data ?? []} isLoading={dashboardIssuesQuery.isLoading} />
      )}

      {tab === 'reminders' && (
        <RemindersPanel
          projectId={projectId}
          isManager={isManager}
          members={membersQuery.data ?? []}
          reminders={remindersQuery.data?.data ?? []}
          isLoading={remindersQuery.isLoading}
        />
      )}

      <IssueFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        members={membersQuery.data ?? []}
        hierarchy={hierarchyQuery.data ?? []}
      />
    </>
  );
}

// ── Excel export (client-side, SheetJS) ─────────────────────────────────
function exportIssuesToExcel(issues: IssueListItem[]) {
  const rows = issues.map((i) => ({
    'Issue #': i.issueNumber ?? i.id,
    Title: i.title,
    Status: STATUS_LABELS[i.status],
    Priority: PRIORITY_LABELS[i.priority],
    Type: ISSUE_TYPE_LABELS[i.issueType],
    Category: i.category ? CATEGORY_LABELS[i.category] : '',
    Discipline: i.discipline ? DISCIPLINE_LABELS[i.discipline] : '',
    Assignee: i.assignedToName ?? '',
    Location: i.locationName ?? i.buildingName ?? '',
    Deadline: i.deadline ? formatDeadline(i.deadline) : '',
    Created: formatDateTime(i.createdAt),
    Closed: i.closedAt ? formatDateTime(i.closedAt) : '',
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Issues');
  XLSX.writeFile(workbook, `issues-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Manager-only dashboard ────────────────────────────────────────────────
interface UserKpiRow {
  userId: string;
  name: string;
  raised: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  overdue: number;
  avgCloseDays: number | null;
}

function computeUserKpis(issues: IssueListItem[]): UserKpiRow[] {
  const map = new Map<string, UserKpiRow & { closeDurationsMs: number[] }>();
  function row(id: string, name: string) {
    if (!map.has(id)) {
      map.set(id, {
        userId: id, name, raised: 0, open: 0, inProgress: 0, resolved: 0, closed: 0, overdue: 0,
        avgCloseDays: null, closeDurationsMs: [],
      });
    }
    return map.get(id)!;
  }
  for (const issue of issues) {
    if (issue.createdBy) row(issue.createdBy, issue.createdByName ?? 'Unknown').raised += 1;
    if (issue.assignedTo) {
      const r = row(issue.assignedTo, issue.assignedToName ?? 'Unknown');
      if (issue.status === 'open') r.open += 1;
      if (issue.status === 'in_progress' || issue.status === 'assigned') r.inProgress += 1;
      if (issue.status === 'resolved') r.resolved += 1;
      if (issue.status === 'closed') r.closed += 1;
      if (isOverdue(issue.deadline, issue.status)) r.overdue += 1;
      if (issue.status === 'closed' && issue.closedAt) {
        r.closeDurationsMs.push(new Date(issue.closedAt).getTime() - new Date(issue.createdAt).getTime());
      }
    }
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      avgCloseDays: r.closeDurationsMs.length
        ? r.closeDurationsMs.reduce((a, b) => a + b, 0) / r.closeDurationsMs.length / (1000 * 60 * 60 * 24)
        : null,
    }))
    .sort((a, b) => b.raised + b.open + b.inProgress - (a.raised + a.open + a.inProgress));
}

function IssueDashboard({
  projectId,
  summary,
  dashboardIssues,
  isLoading,
}: {
  projectId: string;
  summary?: { total: number; open: number; inProgress: number; resolved: number; closed: number; critical: number; overdue: number };
  dashboardIssues: IssueListItem[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const kpis = useMemo(() => computeUserKpis(dashboardIssues), [dashboardIssues]);
  const completion = summary && summary.total > 0 ? Math.round((summary.closed / summary.total) * 100) : 0;

  const [warnedUserId, setWarnedUserId] = useState<string | null>(null);
  const warnMutation = useMutation({
    mutationFn: (userId: string) => warnUser(projectId, userId),
    onSuccess: (_result, userId) => {
      setWarnedUserId(userId);
      queryClient.invalidateQueries({ queryKey: ['issues-dashboard', projectId] });
    },
  });

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of dashboardIssues) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return counts;
  }, [dashboardIssues]);

  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of dashboardIssues) counts[i.priority] = (counts[i.priority] ?? 0) + 1;
    return counts;
  }, [dashboardIssues]);

  const maxStatusCount = Math.max(1, ...Object.values(statusCounts));
  const maxPriorityCount = Math.max(1, ...Object.values(priorityCounts));

  return (
    <div className="p-6 space-y-6">
      <p className="text-xs text-ink-500">
        Per-user KPIs and the breakdowns below are computed from the {dashboardIssues.length} most recent issues
        (backend list endpoint caps at 100 per page — projects with more issues than that won't be fully represented here).
      </p>

      {/* Stat tiles */}
      {summary && (
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
          <StatTile label="Critical" value={summary.critical} tone="danger" onClick={() => {}} />
          <StatTile label="Open" value={summary.open} onClick={() => {}} />
          <StatTile label="In Progress" value={summary.inProgress} onClick={() => {}} />
          <StatTile label="Resolved" value={summary.resolved} onClick={() => {}} />
          <StatTile label="Overdue" value={summary.overdue} tone="danger" onClick={() => {}} />
          <StatTile label="Closed" value={summary.closed} onClick={() => {}} />
          <StatTile label="Completion" value={completion} suffix="%" onClick={() => {}} />
        </div>
      )}

      {isLoading && <p className="text-sm text-ink-500">Loading dashboard data…</p>}

      {/* Per-user KPI table */}
      <div>
        <div className="field-label">Per-user workload</div>
        <div className="panel overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-500 border-b border-base-600">
                <th className="p-2">User</th>
                <th className="p-2 text-right">Raised</th>
                <th className="p-2 text-right">Open</th>
                <th className="p-2 text-right">In Progress</th>
                <th className="p-2 text-right">Resolved</th>
                <th className="p-2 text-right">Closed</th>
                <th className="p-2 text-right">Overdue</th>
                <th className="p-2 text-right">Avg close time</th>
                <th className="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.userId} className="border-b border-base-700 last:border-0">
                  <td className="p-2 text-ink-100 font-medium">{k.name}</td>
                  <td className="p-2 text-right tabular-nums">{k.raised}</td>
                  <td className="p-2 text-right tabular-nums">{k.open}</td>
                  <td className="p-2 text-right tabular-nums">{k.inProgress}</td>
                  <td className="p-2 text-right tabular-nums">{k.resolved}</td>
                  <td className="p-2 text-right tabular-nums">{k.closed}</td>
                  <td className={`p-2 text-right tabular-nums ${k.overdue > 0 ? 'text-danger' : ''}`}>{k.overdue}</td>
                  <td className="p-2 text-right tabular-nums">{k.avgCloseDays != null ? `${k.avgCloseDays.toFixed(1)}d` : '—'}</td>
                  <td className="p-2 text-right">
                    {warnedUserId === k.userId && warnMutation.isSuccess ? (
                      <span className="text-xs text-ink-500">
                        {warnMutation.data?.warned ? `Warned (${warnMutation.data.warned})` : 'No overdue issues'}
                      </span>
                    ) : (
                      <button
                        onClick={() => warnMutation.mutate(k.userId)}
                        className="btn-secondary !py-1 !px-2 text-xs"
                        disabled={k.overdue === 0 || (warnMutation.isPending && warnedUserId === k.userId)}
                        title={k.overdue === 0 ? "No overdue issues to warn about" : undefined}
                      >
                        {warnMutation.isPending && warnedUserId === k.userId ? 'Warning…' : 'Warn'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {kpis.length === 0 && !isLoading && (
                <tr><td colSpan={9} className="p-4 text-center text-ink-500">No data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status / priority breakdown — plain CSS bars (no charting library
          in this repo's dependency tree; see ReportsPage.tsx / package.json,
          confirmed before implementing — a new charting dependency was
          intentionally not added). */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="field-label">By status</div>
          <div className="panel p-4 space-y-2">
            {Object.entries(statusCounts).map(([st, count]) => (
              <BarRow key={st} label={STATUS_LABELS[st as keyof typeof STATUS_LABELS] ?? st} value={count} max={maxStatusCount} />
            ))}
            {Object.keys(statusCounts).length === 0 && <p className="text-xs text-ink-500">No data yet.</p>}
          </div>
        </div>
        <div>
          <div className="field-label">By priority</div>
          <div className="panel p-4 space-y-2">
            {Object.entries(priorityCounts).map(([pr, count]) => (
              <BarRow key={pr} label={PRIORITY_LABELS[pr as keyof typeof PRIORITY_LABELS] ?? pr} value={count} max={maxPriorityCount} />
            ))}
            {Object.keys(priorityCounts).length === 0 && <p className="text-xs text-ink-500">No data yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-ink-300 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-base-700 overflow-hidden">
        <div className="h-full bg-signal rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right tabular-nums text-ink-500">{value}</span>
    </div>
  );
}

// ── Reminders tab ─────────────────────────────────────────────────────────
function RemindersPanel({
  projectId,
  isManager,
  members,
  reminders,
  isLoading,
}: {
  projectId: string;
  isManager: boolean;
  members: { userId: string; firstName?: string; lastName?: string; email?: string }[];
  reminders: Awaited<ReturnType<typeof listReminders>>['data'];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [userReminderTarget, setUserReminderTarget] = useState('');
  const [userReminderMessage, setUserReminderMessage] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['issue-reminders', projectId] });
  }

  const broadcastMutation = useMutation({
    mutationFn: () => broadcastReminder(projectId, broadcastMessage.trim()),
    onSuccess: () => { setBroadcastMessage(''); invalidate(); },
  });

  const userReminderMutation = useMutation({
    mutationFn: () => sendUserReminder(projectId, userReminderTarget, userReminderMessage.trim()),
    onSuccess: () => { setUserReminderTarget(''); setUserReminderMessage(''); invalidate(); },
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {isManager && (
        <div className="grid grid-cols-2 gap-4">
          <div className="panel p-4 space-y-2">
            <div className="field-label !mb-0">Broadcast reminder</div>
            <p className="text-xs text-ink-500">Sends to every open (non-closed) issue in this project.</p>
            <textarea
              className="field-input min-h-[64px]"
              placeholder="Reminder message…"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
            />
            <button
              onClick={() => broadcastMutation.mutate()}
              disabled={!broadcastMessage.trim() || broadcastMutation.isPending}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {broadcastMutation.isPending ? 'Sending…' : 'Send broadcast'}
            </button>
            {broadcastMutation.isError && <p className="field-error">{apiErrorMessage(broadcastMutation.error)}</p>}
            {broadcastMutation.isSuccess && <p className="text-xs text-ok">Sent to {broadcastMutation.data.remindersSent} issue(s).</p>}
          </div>

          <div className="panel p-4 space-y-2">
            <div className="field-label !mb-0">Per-user reminder</div>
            <p className="text-xs text-ink-500">Sends to one user's open issues only.</p>
            <select className="field-input" value={userReminderTarget} onChange={(e) => setUserReminderTarget(e.target.value)}>
              <option value="">Select user…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </select>
            <textarea
              className="field-input min-h-[64px]"
              placeholder="Reminder message…"
              value={userReminderMessage}
              onChange={(e) => setUserReminderMessage(e.target.value)}
            />
            <button
              onClick={() => userReminderMutation.mutate()}
              disabled={!userReminderTarget || !userReminderMessage.trim() || userReminderMutation.isPending}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {userReminderMutation.isPending ? 'Sending…' : 'Send reminder'}
            </button>
            {userReminderMutation.isError && <p className="field-error">{apiErrorMessage(userReminderMutation.error)}</p>}
            {userReminderMutation.isSuccess && <p className="text-xs text-ok">Sent to {userReminderMutation.data.remindersSent} issue(s).</p>}
          </div>
        </div>
      )}

      <div>
        <div className="field-label">Reminder log</div>
        {isLoading && <p className="text-sm text-ink-500">Loading…</p>}
        <div className="space-y-1.5">
          {reminders.map((r) => (
            <div key={r.id} className="panel p-3 text-xs">
              <div className="flex items-center gap-2 text-ink-500 mb-1">
                <span className="font-medium text-ink-300">{r.sentByName ?? 'Someone'}</span>
                <span>→</span>
                <span>{r.sentToName ?? 'All open issues'}</span>
                {r.issueNumber && <span className="text-ink-500">· {r.issueNumber}</span>}
                <span className="ml-auto">{formatDateTime(r.createdAt)}</span>
              </div>
              <p className="text-ink-100">{r.message}</p>
            </div>
          ))}
          {reminders.length === 0 && !isLoading && <p className="text-sm text-ink-500">No reminders sent yet.</p>}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
        active ? 'border-signal text-signal font-medium' : 'border-transparent text-ink-500 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}

function StatTile({ label, value, onClick, tone, suffix }: { label: string; value: number; onClick: () => void; tone?: 'danger'; suffix?: string }) {
  return (
    <button onClick={onClick} className="panel p-3 text-left hover:border-blueprint transition-colors">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : 'text-ink-100'}`}>
        {value}{suffix}
      </div>
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
        active ? 'bg-signal text-base-950 border-signal font-medium' : 'border-base-600 text-ink-300 hover:border-base-500'
      }`}
    >
      {children}
    </button>
  );
}

function IssueRow({
  issue, selected, onToggleSelect, onClick,
}: {
  issue: IssueListItem;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const timer = getDeadlineTimer(issue.deadline, issue.status);
  return (
    <div className="panel w-full p-4 hover:border-blueprint transition-colors flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleSelect}
      />
      <button onClick={onClick} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="text-[11px] font-mono text-ink-500">{issue.issueNumber ?? issue.id.slice(0, 8)}</span>
          {issue.locationName && <span className="badge bg-base-700 text-ink-500">{issue.locationName}</span>}
          {issue.discipline && <span className="badge bg-base-700 text-ink-500">{DISCIPLINE_LABELS[issue.discipline]}</span>}
          {issue.category && <span className="badge bg-base-700 text-ink-500">{CATEGORY_LABELS[issue.category]}</span>}
        </div>
        <div className="font-medium text-sm mb-2">{issue.title}</div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className={`badge ${STATUS_BADGE_CLASS[issue.status]}`}>{STATUS_LABELS[issue.status]}</span>
          <span className={`badge ${PRIORITY_BADGE_CLASS[issue.priority]}`}>{PRIORITY_LABELS[issue.priority]}</span>
          <span className={`badge ${TIMER_BADGE_CLASS[timer.state]}`}>{timer.label}</span>
          <span className="text-ink-500">{issue.assignedToName ?? 'Unassigned'}</span>
          <span className="text-ink-500 ml-auto">Due {formatDeadline(issue.deadline)}</span>
        </div>
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" strokeLinecap="round" />
    </svg>
  );
}
