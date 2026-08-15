import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, RFI_IMPACT_LEVELS, RFI_IMPACT_LEVEL_LABELS } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { RfiFormModal } from '../components/RfiFormModal';
import { listRfis, getRfiSummary } from '../lib/rfis.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  RFI_STATUS_LABELS, RFI_WORKFLOW_STATUS_LABELS, RFI_WORKFLOW_STATUS_BADGE_CLASS,
  RFI_PRIORITY_LABELS, RFI_PRIORITY_BADGE_CLASS, isRfiOverdue, formatDate,
} from '../lib/rfi-constants';
import { getDeadlineTimer, TIMER_BADGE_CLASS } from '../lib/issue-constants';

export default function RfisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [costImpactLevel, setCostImpactLevel] = useState('');
  const [timeImpactLevel, setTimeImpactLevel] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

  const summaryQuery = useQuery({
    queryKey: ['rfi-summary', projectId],
    queryFn: () => getRfiSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const rfisQuery = useQuery({
    queryKey: ['rfis', projectId, status, discipline, costImpactLevel, timeImpactLevel, assignedTo, dateFrom, dateTo],
    queryFn: () => listRfis(projectId!, {
      perPage: 100,
      status: status || undefined,
      discipline: discipline || undefined,
      costImpactLevel: costImpactLevel || undefined,
      timeImpactLevel: timeImpactLevel || undefined,
      assignedTo: assignedTo || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    enabled: Boolean(projectId),
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="RFIs"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + New RFI
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {(['open', 'answered', 'closed', 'void'] as const).map((s) => (
              <option key={s} value={s}>{RFI_STATUS_LABELS[s]}</option>
            ))}
          </select>

          <select className="field-input w-auto" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option value="">All disciplines</option>
            {RFI_DISCIPLINES.map((d) => (
              <option key={d} value={d}>{RFI_DISCIPLINE_LABELS[d]}</option>
            ))}
          </select>

          <select className="field-input w-auto" value={costImpactLevel} onChange={(e) => setCostImpactLevel(e.target.value)}>
            <option value="">Any cost impact</option>
            {RFI_IMPACT_LEVELS.map((l) => (
              <option key={l} value={l}>{RFI_IMPACT_LEVEL_LABELS[l]}</option>
            ))}
          </select>

          <select className="field-input w-auto" value={timeImpactLevel} onChange={(e) => setTimeImpactLevel(e.target.value)}>
            <option value="">Any time impact</option>
            {RFI_IMPACT_LEVELS.map((l) => (
              <option key={l} value={l}>{RFI_IMPACT_LEVEL_LABELS[l]}</option>
            ))}
          </select>

          <select className="field-input w-auto" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Anyone assigned</option>
            {(membersQuery.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              className="field-input w-auto"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Created from"
            />
            <span className="text-ink-500 text-xs">to</span>
            <input
              type="date"
              className="field-input w-auto"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Created to"
            />
          </div>

          {summaryQuery.data && (
            <div className="flex gap-2 text-[10px] font-mono text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>·</span>
              <span>{summaryQuery.data.open} open</span>
              <span>·</span>
              <span className={summaryQuery.data.overdue > 0 ? 'text-danger' : ''}>{summaryQuery.data.overdue} overdue</span>
            </div>
          )}
        </div>

        {rfisQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {rfisQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No RFIs yet. Raise one to ask a formal question that needs a documented answer.
          </div>
        )}

        {(rfisQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">Discipline</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Cost impact</th>
                  <th className="px-4 py-2.5 font-medium">Time impact</th>
                  <th className="px-4 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 font-medium">Aging</th>
                </tr>
              </thead>
              <tbody>
                {(rfisQuery.data?.data ?? []).map((r) => {
                  const overdue = isRfiOverdue(r.dueDate, r.status);
                  // getDeadlineTimer is typed for IssueStatus, but its only status-aware
                  // branch is a plain string check against 'closed'/'void' -- both of
                  // which are also legal RfiWorkflowStatus values, so this is
                  // functionally correct at runtime; same cast RfiDetailPage already
                  // uses for its own Aging badge.
                  const aging = getDeadlineTimer(r.dueDate, r.status as never);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/projects/${projectId}/rfis/${r.id}`)}
                      className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{r.rfiNumber ?? '—'}</td>
                      <td className="px-4 py-2.5">{r.subject}</td>
                      <td className="px-4 py-2.5 text-ink-300">{r.discipline ? RFI_DISCIPLINE_LABELS[r.discipline] : '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge ${RFI_WORKFLOW_STATUS_BADGE_CLASS[r.status]}`}>{RFI_WORKFLOW_STATUS_LABELS[r.status]}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge ${RFI_PRIORITY_BADGE_CLASS[r.priority]}`}>{RFI_PRIORITY_LABELS[r.priority]}</span></td>
                      <td className="px-4 py-2.5 text-ink-300">{RFI_IMPACT_LEVEL_LABELS[r.costImpactLevel ?? (r.costImpact ? 'yes' : 'no')]}</td>
                      <td className="px-4 py-2.5 text-ink-300">{RFI_IMPACT_LEVEL_LABELS[r.timeImpactLevel ?? (r.timeImpact ? 'yes' : 'no')]}</td>
                      <td className="px-4 py-2.5 text-ink-300">{r.assignedToName ?? 'Unassigned'}</td>
                      <td className={`px-4 py-2.5 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(r.dueDate)}</td>
                      <td className="px-4 py-2.5"><span className={`badge ${TIMER_BADGE_CLASS[aging.state]}`}>{aging.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RfiFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
    </>
  );
}
