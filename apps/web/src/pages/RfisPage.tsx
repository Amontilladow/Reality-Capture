import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, RFI_IMPACT_LEVELS, RFI_IMPACT_LEVEL_LABELS, DRAWING_UPDATE_STATUS_LABELS,
  type RfiImpactLevel,
} from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { RfiFormModal } from '../components/RfiFormModal';
import { RfiNoticeLetterModal } from '../components/RfiNoticeLetterModal';
import {
  listRfis, getRfiSummary, updateRfi, markRfiDrawingApplied, markRfiDrawingNotApplied,
  markRfiDrawingSentToSite, markRfiDrawingNotSentToSite, remindRfiDrawingUpdate,
  type RfiListItem,
} from '../lib/rfis.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  RFI_STATUS_LABELS, RFI_WORKFLOW_STATUS_LABELS, RFI_WORKFLOW_STATUS_BADGE_CLASS,
  RFI_PRIORITY_LABELS, RFI_PRIORITY_BADGE_CLASS, isRfiOverdue, formatDate,
} from '../lib/rfi-constants';
import { getDeadlineTimer, TIMER_BADGE_CLASS } from '../lib/issue-constants';
import { apiErrorMessage } from '../lib/api';

// Warning-colored badge classes for the Cost/Time impact columns -- uses
// this codebase's `warn` token, same as RFI_WORKFLOW_STATUS_BADGE_CLASS's
// own under_review entry (bg-warn/15 text-warn), per the ticket's explicit
// "warning-colored" call-out.
const COST_IMPACT_BADGE_CLASS = 'badge bg-warn/15 text-warn';
const TIME_IMPACT_BADGE_CLASS = 'badge bg-warn/15 text-warn';

// Falls back to the legacy boolean when the 4-state level field is absent,
// same precedence the backend and RfiDetailPage/RfiFormModal already use.
function effectiveImpactLevel(level: RfiListItem['costImpactLevel'], legacyBool: boolean | undefined) {
  return level ?? (legacyBool ? 'yes' : 'no');
}

export default function RfisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [costImpactLevel, setCostImpactLevel] = useState('');
  const [timeImpactLevel, setTimeImpactLevel] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [letterRfi, setLetterRfi] = useState<RfiListItem | null>(null);

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

  const [drawingActionError, setDrawingActionError] = useState('');

  function invalidateDrawingViews() {
    queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
    queryClient.invalidateQueries({ queryKey: ['report-kpis', projectId] });
  }

  // Lets the Drawing/Model Updated status itself be set right from the
  // list, not just the Applied/Sent-to-Site follow-up toggles -- same PATCH
  // endpoint the RFI detail form/edit view already uses for this field.
  const updateDrawingLevelMutation = useMutation({
    mutationFn: ({ rfiId, level }: { rfiId: string; level: RfiImpactLevel }) =>
      updateRfi(projectId!, rfiId, { drawingImpactLevel: level }),
    onSuccess: invalidateDrawingViews,
    onError: (err) => setDrawingActionError(apiErrorMessage(err)),
  });

  const toggleDrawingAppliedMutation = useMutation({
    mutationFn: ({ rfiId, applied }: { rfiId: string; applied: boolean }) =>
      applied ? markRfiDrawingNotApplied(projectId!, rfiId) : markRfiDrawingApplied(projectId!, rfiId),
    onSuccess: invalidateDrawingViews,
    onError: (err) => setDrawingActionError(apiErrorMessage(err)),
  });

  const toggleDrawingSentToSiteMutation = useMutation({
    mutationFn: ({ rfiId, sent }: { rfiId: string; sent: boolean }) =>
      sent ? markRfiDrawingNotSentToSite(projectId!, rfiId) : markRfiDrawingSentToSite(projectId!, rfiId),
    onSuccess: invalidateDrawingViews,
    onError: (err) => setDrawingActionError(apiErrorMessage(err)),
  });

  const remindDrawingMutation = useMutation({
    mutationFn: (rfiId: string) => remindRfiDrawingUpdate(projectId!, rfiId),
    onError: (err) => setDrawingActionError(apiErrorMessage(err)),
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

        {drawingActionError && <p className="field-error">{drawingActionError}</p>}

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
                  <th className="px-4 py-2.5 font-medium">Drawing/Model Updated</th>
                  <th className="px-4 py-2.5 font-medium">Sent to Site</th>
                  <th className="px-4 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 font-medium">Aging</th>
                  <th className="px-4 py-2.5 font-medium">Notice</th>
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
                  const costImpacting = effectiveImpactLevel(r.costImpactLevel, r.costImpact) !== 'no';
                  const timeImpacting = effectiveImpactLevel(r.timeImpactLevel, r.timeImpact) !== 'no';
                  const hasImpact = costImpacting || timeImpacting;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/projects/${projectId}/rfis/${r.id}`)}
                      className={`border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer ${hasImpact ? 'border-l-2 border-l-warn bg-warn/5' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{r.rfiNumber ?? '—'}</td>
                      <td className="px-4 py-2.5">{r.subject}</td>
                      <td className="px-4 py-2.5 text-ink-300">{r.discipline ? RFI_DISCIPLINE_LABELS[r.discipline] : '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge ${RFI_WORKFLOW_STATUS_BADGE_CLASS[r.status]}`}>{RFI_WORKFLOW_STATUS_LABELS[r.status]}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge ${RFI_PRIORITY_BADGE_CLASS[r.priority]}`}>{RFI_PRIORITY_LABELS[r.priority]}</span></td>
                      <td className="px-4 py-2.5">
                        {costImpacting ? (
                          <span className={COST_IMPACT_BADGE_CLASS}>💰 Cost</span>
                        ) : (
                          <span className="text-ink-300">{RFI_IMPACT_LEVEL_LABELS[effectiveImpactLevel(r.costImpactLevel, r.costImpact)]}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {timeImpacting ? (
                          <span className={TIME_IMPACT_BADGE_CLASS}>⏱ Time</span>
                        ) : (
                          <span className="text-ink-300">{RFI_IMPACT_LEVEL_LABELS[effectiveImpactLevel(r.timeImpactLevel, r.timeImpact)]}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Editable right from the list, not just the RFI
                              form -- same PATCH the detail page's own edit
                              view already sends for this field. */}
                          <select
                            value={r.drawingImpactLevel ?? 'no'}
                            onChange={(e) => updateDrawingLevelMutation.mutate({ rfiId: r.id, level: e.target.value as RfiImpactLevel })}
                            disabled={updateDrawingLevelMutation.isPending}
                            title={DRAWING_UPDATE_STATUS_LABELS[r.drawingImpactLevel ?? 'no']}
                            className={`field-input w-auto !py-1 !text-xs ${(r.drawingImpactLevel ?? 'no') === 'no' ? '!text-ink-300' : '!border-warn/40 !text-warn'}`}
                          >
                            {RFI_IMPACT_LEVELS.map((l) => (
                              <option key={l} value={l}>{DRAWING_UPDATE_STATUS_LABELS[l]}</option>
                            ))}
                          </select>
                          {(r.drawingImpactLevel ?? 'no') !== 'no' && (
                            <>
                              <button
                                type="button"
                                onClick={() => toggleDrawingAppliedMutation.mutate({ rfiId: r.id, applied: Boolean(r.drawingUpdateApplied) })}
                                disabled={toggleDrawingAppliedMutation.isPending}
                                className={r.drawingUpdateApplied ? 'text-ok text-xs underline' : 'text-blueprint hover:text-blueprint-hover text-xs underline'}
                              >
                                {r.drawingUpdateApplied ? 'Applied' : 'Not applied'}
                              </button>
                              {!r.drawingUpdateApplied && (
                                <button
                                  type="button"
                                  onClick={() => remindDrawingMutation.mutate(r.id)}
                                  disabled={remindDrawingMutation.isPending}
                                  className="text-ink-500 hover:text-ink-300 text-xs underline"
                                >
                                  Remind
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {(r.drawingImpactLevel ?? 'no') === 'no' ? (
                          <span className="text-ink-500">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleDrawingSentToSiteMutation.mutate({ rfiId: r.id, sent: Boolean(r.drawingUpdateSentToSite) })}
                            disabled={toggleDrawingSentToSiteMutation.isPending}
                            className={`badge cursor-pointer ${r.drawingUpdateSentToSite ? 'bg-ok/15 text-ok' : 'bg-base-600 text-ink-300'}`}
                          >
                            {r.drawingUpdateSentToSite ? '✓ Sent' : 'Not sent'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-300">{r.assignedToName ?? 'Unassigned'}</td>
                      <td className={`px-4 py-2.5 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(r.dueDate)}</td>
                      <td className="px-4 py-2.5"><span className={`badge ${TIMER_BADGE_CLASS[aging.state]}`}>{aging.label}</span></td>
                      <td className="px-4 py-2.5">
                        {!hasImpact ? (
                          <span className="text-ink-500">—</span>
                        ) : r.noticeLetterStatus === 'shared' ? (
                          <span className="inline-flex items-center gap-1 text-ok text-xs" title={`Shared ${formatDate(r.noticeLetterSharedAt)}`}>
                            <CheckIcon /> {formatDate(r.noticeLetterSharedAt)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setLetterRfi(r); }}
                            className="text-blueprint hover:text-blueprint-hover text-xs underline"
                          >
                            {r.noticeLetterStatus === 'draft' ? 'Edit letter' : 'Create letter'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RfiFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
      <RfiNoticeLetterModal
        open={Boolean(letterRfi)}
        onClose={() => setLetterRfi(null)}
        projectId={projectId}
        rfi={letterRfi}
        project={projectQuery.data}
        members={membersQuery.data ?? []}
      />
    </>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
