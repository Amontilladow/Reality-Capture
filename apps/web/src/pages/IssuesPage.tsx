import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { IssueFormModal } from '../components/issues/IssueFormModal';
import { IssueDetail } from '../components/issues/IssueDetail';
import { listIssues, getIssueSummary, type IssueListItem, type IssueDetailItem } from '../lib/issues.api';
import { getMembers, getHierarchy } from '../lib/projects.api';
import {
  STATUS_LABELS, STATUS_BADGE_CLASS, PRIORITY_LABELS, PRIORITY_BADGE_CLASS,
  ISSUE_STATUSES, isOverdue, formatDeadline,
} from '../lib/issue-constants';

type QuickFilter = 'all' | 'overdue' | 'critical' | 'mine';

export default function IssuesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
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

  const advancedActive = Boolean(assignedTo || discipline || dateFrom || dateTo);
  function clearAdvanced() {
    setAssignedTo('');
    setDiscipline('');
    setDateFrom('');
    setDateTo('');
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

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title="Issues"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <PlusIcon /> New issue
          </button>
        }
      />

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
              <input id="fDiscipline" className="field-input" placeholder="MEP, Structural…" value={discipline} onChange={(e) => setDiscipline(e.target.value)} />
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

        {/* List */}
        {issuesQuery.isLoading && <p className="text-sm text-ink-500">Loading issues…</p>}
        {issuesQuery.data?.data.length === 0 && (
          <div className="panel p-10 text-center text-sm text-ink-500">No issues match this filter.</div>
        )}
        <div className="space-y-2">
          {(issuesQuery.data?.data ?? []).map((issue) => (
            <IssueRow key={issue.id} issue={issue} onClick={() => setViewIssueId(issue.id)} />
          ))}
        </div>
      </div>

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

function StatTile({ label, value, onClick, tone }: { label: string; value: number; onClick: () => void; tone?: 'danger' }) {
  return (
    <button onClick={onClick} className="panel p-3 text-left hover:border-blueprint transition-colors">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : 'text-ink-100'}`}>{value}</div>
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

function IssueRow({ issue, onClick }: { issue: IssueListItem; onClick: () => void }) {
  const overdue = isOverdue(issue.deadline, issue.status);
  return (
    <button onClick={onClick} className="panel w-full text-left p-4 hover:border-blueprint transition-colors">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-[11px] font-mono text-ink-500">{issue.issueNumber ?? issue.id.slice(0, 8)}</span>
        {issue.locationName && <span className="badge bg-base-700 text-ink-500">{issue.locationName}</span>}
        {issue.discipline && <span className="badge bg-base-700 text-ink-500">{issue.discipline}</span>}
      </div>
      <div className="font-medium text-sm mb-2">{issue.title}</div>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className={`badge ${STATUS_BADGE_CLASS[issue.status]}`}>{STATUS_LABELS[issue.status]}</span>
        <span className={`badge ${PRIORITY_BADGE_CLASS[issue.priority]}`}>{PRIORITY_LABELS[issue.priority]}</span>
        {overdue && <span className="badge bg-danger/20 text-danger">Overdue</span>}
        <span className="text-ink-500">{issue.assignedToName ?? 'Unassigned'}</span>
        <span className="text-ink-500 ml-auto">Due {formatDeadline(issue.deadline)}</span>
      </div>
    </button>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
