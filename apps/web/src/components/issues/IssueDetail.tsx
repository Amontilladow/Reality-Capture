import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getIssue, updateIssue, closeIssue, deleteIssue, getActivities, addComment, addEvidenceCapture,
  forwardIssue, forceIssueStatus, uploadIssueAttachment, downloadIssuePdf, downloadIssueXls,
  scheduleIssueReminder, listPendingIssueReminders, cancelIssueReminder, getIssueEvidence,
  type IssueDetailItem,
} from '../../lib/issues.api';
import { listCaptures } from '../../lib/captures.api';
import { CaptureGrid } from '../CaptureGrid';
import { EmailComposerModal } from '../EmailComposerModal';
import { EmailHistoryList } from '../EmailHistoryList';
import { InlineRiskAssessment } from '../RiskIntelligenceSection';
import { getMembers } from '../../lib/projects.api';
import { useAuthStore } from '../../store/auth.store';
import {
  STATUS_LABELS, PRIORITY_LABELS,
  ISSUE_TYPE_LABELS, ISSUE_STATUS_FLOW, ISSUE_STATUSES, DISCIPLINE_LABELS, CATEGORY_LABELS,
  getDeadlineTimer, TIMER_BADGE_CLASS, formatDeadline, formatDateTime, isIssueManager,
} from '../../lib/issue-constants';
import { ISSUE_STATUS_TONE, ISSUE_PRIORITY_TONE } from '../../lib/status-tone';
import { StatusBadge } from '../ui/Badge';
import { apiErrorMessage } from '../../lib/api';
import type { IssueStatus } from '@engineeringos/types';
import { Listbox } from '../ui/Listbox';
import { Collapsible } from '../ui/Collapsible';
import { SaveButton } from '../workspace/SaveButton';
import { Menu, type MenuSection } from '../ui/Menu';

export function IssueDetail({
  projectId,
  issueId,
  onBack,
  onEdit,
}: {
  projectId: string;
  issueId: string;
  onBack: () => void;
  onEdit: (issue: IssueDetailItem) => void;
}) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isManager = isIssueManager(currentUser?.companyRole);

  const [comment, setComment] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardComment, setForwardComment] = useState('');
  const [forceStatusValue, setForceStatusValue] = useState<IssueStatus | ''>('');
  const [attachComment, setAttachComment] = useState('');
  const [downloading, setDownloading] = useState<'pdf' | 'xls' | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderWhen, setReminderWhen] = useState('');
  const [reminderMessage, setReminderMessage] = useState('');
  const [forceOpen, setForceOpen] = useState(false);
  const navigate = useNavigate();

  const issueQuery = useQuery({
    queryKey: ['issue', projectId, issueId],
    queryFn: () => getIssue(projectId, issueId),
  });

  const activitiesQuery = useQuery({
    queryKey: ['issue-activities', projectId, issueId],
    queryFn: () => getActivities(projectId, issueId),
  });

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId),
  });

  const pendingRemindersQuery = useQuery({
    queryKey: ['issue-scheduled-reminders', projectId, issueId],
    queryFn: () => listPendingIssueReminders(projectId, issueId),
  });

  // Photos/videos from the pin this issue was raised from, if any; same
  // captures.location_id relationship PinPanel.tsx's own "History" grid
  // reads, so the two stay in sync automatically (adding a photo from
  // either side shows up in both). Distinct from the "Evidence photos"
  // section below (issue_captures, manually attached, unrelated pin or not).
  const pinCapturesQuery = useQuery({
    queryKey: ['captures', projectId, 'pin', issueQuery.data?.locationId],
    queryFn: () => listCaptures(projectId, { locationId: issueQuery.data!.locationId, perPage: 50 }),
    enabled: Boolean(issueQuery.data?.locationId),
  });

  // F5: drives the Close button's client-side gating below; the backend
  // is the real enforcement point (close()/forceStatus()/bulkClose() all
  // reject with no evidence regardless of what this query returns).
  const evidenceQuery = useQuery({
    queryKey: ['issue-evidence', projectId, issueId],
    queryFn: () => getIssueEvidence(projectId, issueId),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['issue', projectId, issueId] });
    queryClient.invalidateQueries({ queryKey: ['issue-activities', projectId, issueId] });
    queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
    queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
    queryClient.invalidateQueries({ queryKey: ['issue-evidence', projectId, issueId] });
  }

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateIssue(projectId, issueId, { status: status as never }),
    onSuccess: invalidateAll,
  });

  // F5: closing an issue now requires (a) at least one evidence capture
  // attached and (b) a permitted-approver role (company admin or
  // engineering manager): "the creator can always close their own work"
  // is gone, enforced server-side by IssuesService.close().
  const closeMutation = useMutation({
    mutationFn: () => closeIssue(projectId, issueId),
    onSuccess: invalidateAll,
  });

  const commentMutation = useMutation({
    mutationFn: () => addComment(projectId, issueId, comment.trim()),
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['issue-activities', projectId, issueId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteIssue(projectId, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
      onBack();
    },
  });

  const forwardMutation = useMutation({
    mutationFn: () => forwardIssue(projectId, issueId, { toUserId: forwardTo, comment: forwardComment || undefined }),
    onSuccess: () => {
      setForwardOpen(false);
      setForwardTo('');
      setForwardComment('');
      invalidateAll();
    },
  });

  const forceStatusMutation = useMutation({
    mutationFn: () => forceIssueStatus(projectId, issueId, forceStatusValue as IssueStatus),
    onSuccess: () => {
      setForceStatusValue('');
      invalidateAll();
    },
  });

  const attachMutation = useMutation({
    mutationFn: (file: File) => uploadIssueAttachment(projectId, issueId, file, attachComment || undefined),
    onSuccess: () => {
      setAttachComment('');
      queryClient.invalidateQueries({ queryKey: ['issue-activities', projectId, issueId] });
    },
  });

  const scheduleReminderMutation = useMutation({
    mutationFn: () => scheduleIssueReminder(projectId, issueId, { scheduledFor: new Date(reminderWhen).toISOString(), message: reminderMessage.trim() }),
    onSuccess: () => {
      setReminderOpen(false);
      setReminderWhen('');
      setReminderMessage('');
      queryClient.invalidateQueries({ queryKey: ['issue-scheduled-reminders', projectId, issueId] });
    },
  });

  const cancelReminderMutation = useMutation({
    mutationFn: (reminderId: string) => cancelIssueReminder(projectId, issueId, reminderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue-scheduled-reminders', projectId, issueId] }),
  });

  const issue = issueQuery.data;

  if (issueQuery.isLoading) return <div className="p-6 text-sm text-ink-500">Loading…</div>;
  if (!issue) return <div className="p-6 text-sm text-danger">Issue not found.</div>;

  const timer = getDeadlineTimer(issue.deadline, issue.status);
  const currentStepIdx = ISSUE_STATUS_FLOW.indexOf(issue.status);

  // Mirrors the backend's own authorization exactly (IssuesService.close()/
  // forward()). F5: closing requires a permitted-approver role (the old
  // "creator can always close their own issue" bypass is gone) AND at
  // least one evidence capture attached; isManager alone decided this
  // before; now hasEvidence gates it too.
  const isCreator = currentUser?.id === issue.createdBy;
  const isCurrentAssignee = Boolean(currentUser?.id && currentUser.id === issue.assignedTo);
  const hasEvidence = (evidenceQuery.data?.length ?? 0) > 0;
  const canClose = isManager && hasEvidence;
  const canForward = isCurrentAssignee || (!issue.assignedTo && isCreator) || isManager;
  const members = membersQuery.data ?? [];

  async function handleDownloadPdf() {
    if (!issue) return;
    setDownloadError('');
    setDownloading('pdf');
    try {
      await downloadIssuePdf(projectId, issueId, `${issue.issueNumber ?? issue.id}.pdf`);
    } catch (err) {
      setDownloadError(apiErrorMessage(err));
    } finally {
      setDownloading(null);
    }
  }

  async function handleDownloadXls() {
    if (!issue) return;
    setDownloadError('');
    setDownloading('xls');
    try {
      await downloadIssueXls(projectId, issueId, `${issue.issueNumber ?? issue.id}.xlsx`);
    } catch (err) {
      setDownloadError(apiErrorMessage(err));
    } finally {
      setDownloading(null);
    }
  }

  // The one obvious next step: the next stage of the workflow, or Close /
  // Reopen at the end of it. Every other transition sits in the Status menu.
  const nextStatus = ISSUE_STATUS_FLOW[currentStepIdx + 1];
  const where = [issue.buildingName, issue.levelName, issue.locationName].filter(Boolean).join(' · ');
  const nextStep = issue.status === 'closed'
    ? null
    : !issue.assignedTo
    ? { text: 'Nobody is assigned yet. Assign someone so the work has an owner.', action: 'Assign someone', run: () => onEdit(issue) }
    : !hasEvidence
      ? { text: 'Add an evidence photo of the issue or the fix. Closing needs at least one.', action: 'Attach a capture', run: () => setPickerOpen(true) }
      : nextStatus && nextStatus !== 'closed'
        ? { text: `${issue.assignedToName ?? 'The assignee'} owns this. When the work is ready, move it to ${STATUS_LABELS[nextStatus]}.`, action: `Move to ${STATUS_LABELS[nextStatus]}`, run: () => statusMutation.mutate(nextStatus) }
        : null;

  const moreSections: MenuSection[] = [
    {
      heading: 'Issue',
      items: [
        { label: 'Edit', icon: <EditIcon />, onSelect: () => onEdit(issue) },
        { label: 'Email', icon: <MailIcon />, onSelect: () => setComposeEmailOpen(true) },
        ...(canForward ? [{ label: 'Forward to…', icon: <ForwardIcon />, onSelect: () => { setReminderOpen(false); setForwardOpen(true); } }] : []),
        { label: 'Schedule reminder…', icon: <BellIcon />, onSelect: () => { setForwardOpen(false); setReminderOpen(true); } },
        { label: 'Ask AI about this', icon: <SparkIcon />, onSelect: () => navigate(`/projects/${projectId}/assistant?resourceType=issue&resourceId=${issue.id}`) },
      ],
    },
    {
      heading: 'Download',
      items: [
        { label: downloading === 'pdf' ? 'Preparing PDF…' : 'PDF report', icon: <DownloadIcon />, onSelect: handleDownloadPdf, disabled: downloading === 'pdf' },
        { label: downloading === 'xls' ? 'Preparing Excel…' : 'Excel (XLS)', icon: <DownloadIcon />, onSelect: handleDownloadXls, disabled: downloading === 'xls' },
      ],
    },
    {
      items: [{
        label: 'Delete issue',
        icon: <TrashIcon />,
        danger: true,
        onSelect: () => { if (confirm('Delete this issue? This cannot be undone.')) deleteMutation.mutate(); },
      }],
    },
  ];

  const statusSections: MenuSection[] = [
    {
      heading: 'Move to',
      items: [
        ...ISSUE_STATUS_FLOW.filter((s) => s !== issue.status && s !== 'closed').map((s) => ({
          label: STATUS_LABELS[s],
          onSelect: () => statusMutation.mutate(s),
          disabled: statusMutation.isPending,
        })),
        ...(issue.status !== 'closed' ? [{
          label: canClose ? STATUS_LABELS.closed : `${STATUS_LABELS.closed} (${!isManager ? 'needs a manager' : 'needs evidence'})`,
          onSelect: () => closeMutation.mutate(),
          disabled: !canClose || closeMutation.isPending,
        }] : []),
        ...((issue.status === 'closed' || issue.status === 'resolved') ? [{ label: 'Reopen', onSelect: () => statusMutation.mutate('reopened') }] : []),
      ],
    },
    ...(isManager ? [{ heading: 'Admin', items: [{ label: 'Force status…', onSelect: () => setForceOpen(true) }] }] : []),
  ];

  return (
    <div className="px-6 pt-6 pb-10 space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-xs text-ink-500 hover:text-ink-100 transition-colors">
        <BackIcon /> Back to issues
      </button>

      {/* Header: what the issue is and where, then the next step. */}
      <header className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-ink-300">{issue.issueNumber ?? issue.id}</span>
              <StatusBadge tone={ISSUE_PRIORITY_TONE[issue.priority]} label={PRIORITY_LABELS[issue.priority]} />
              <StatusBadge tone={ISSUE_STATUS_TONE[issue.status]} label={STATUS_LABELS[issue.status]} />
              <span className={`badge ${TIMER_BADGE_CLASS[timer.state]}`} title={`Due ${formatDeadline(issue.deadline)}`}>{timer.label}</span>
              {issue.status === 'reopened' && <span className="badge bg-danger/15 text-danger">Reopened, outside the normal flow</span>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-100 break-words">{issue.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-300">
              {where && <span className="flex items-center gap-2"><PinIcon />{where}</span>}
              {issue.discipline && DISCIPLINE_LABELS[issue.discipline] && <><span className="text-ink-500" aria-hidden="true">·</span><span>{DISCIPLINE_LABELS[issue.discipline]}</span></>}
              {issue.category && <><span className="text-ink-500" aria-hidden="true">·</span><span>{CATEGORY_LABELS[issue.category]}</span></>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Menu label="Change status" buttonContent={<>Status <ChevronIcon /></>} sections={statusSections} />
            {nextStatus && nextStatus !== 'closed' ? (
              <button onClick={() => statusMutation.mutate(nextStatus)} disabled={statusMutation.isPending} className="btn-primary">
                Move to {STATUS_LABELS[nextStatus]}
              </button>
            ) : issue.status === 'closed' || issue.status === 'resolved' ? (
              <button onClick={() => statusMutation.mutate('reopened')} disabled={statusMutation.isPending} className="btn-secondary">Reopen</button>
            ) : nextStatus === 'closed' ? (
              <button
                onClick={() => closeMutation.mutate()}
                disabled={!canClose || closeMutation.isPending}
                title={canClose ? undefined : !isManager ? 'Closing requires sign-off from a permitted role (an engineering manager or company admin).' : 'Attach at least one evidence photo before closing.'}
                className="btn-primary"
              >
                {closeMutation.isPending ? 'Closing…' : 'Close issue'}
              </button>
            ) : null}
            <SaveButton itemType="issue" itemId={issue.id} />
            <Menu
              label="More actions"
              buttonClassName="btn-secondary !w-9 !px-0"
              buttonContent={<DotsIcon />}
              sections={moreSections}
            />
          </div>
        </div>

        {/* Where the issue is in its workflow. */}
        {ISSUE_STATUS_FLOW.includes(issue.status) && (
          <ol aria-label="Workflow progress" className="flex items-start gap-2">
            {ISSUE_STATUS_FLOW.map((s, i) => (
              <li key={s} className="flex-1 min-w-0" aria-current={i === currentStepIdx ? 'step' : undefined}>
                <span className={`block h-1.5 rounded-full ${i < currentStepIdx ? 'bg-ok' : i === currentStepIdx ? 'bg-signal' : 'bg-ink-100/10'}`} />
                <span className={`mt-2 block text-eyebrow truncate ${i === currentStepIdx ? 'text-ink-100 font-semibold' : 'text-ink-500'}`}>{STATUS_LABELS[s]}</span>
              </li>
            ))}
          </ol>
        )}

        {statusMutation.isError && <p className="field-error">{apiErrorMessage(statusMutation.error)}</p>}
        {closeMutation.isError && <p className="field-error">{apiErrorMessage(closeMutation.error)}</p>}
        {downloadError && <p className="field-error">{downloadError}</p>}
      </header>

      {/* Forward / reminder / force-status forms open here, from the menus. */}
      {canForward && forwardOpen && (
        <section className="panel p-6 space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Forward to someone</h2><button onClick={() => setForwardOpen(false)} className="btn-ghost">Cancel</button></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Listbox aria-label="Forward to" className="field-input" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)}>
              <option value="">Forward to…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </Listbox>
            <input className="field-input" placeholder="Optional note…" value={forwardComment} onChange={(e) => setForwardComment(e.target.value)} />
          </div>
          <button onClick={() => forwardMutation.mutate()} disabled={!forwardTo || forwardMutation.isPending} className="btn-primary">
            {forwardMutation.isPending ? 'Forwarding…' : 'Send forward'}
          </button>
          {forwardMutation.isError && <p className="field-error">{apiErrorMessage(forwardMutation.error)}</p>}
        </section>
      )}

      {reminderOpen && (
        <section className="panel p-6 space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Schedule a reminder</h2><button onClick={() => setReminderOpen(false)} className="btn-ghost">Cancel</button></div>
          {!issue.assignedTo ? (
            <p className="text-sm text-ink-500">This issue has no assignee yet. Assign it to someone before scheduling a reminder.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="datetime-local" className="field-input" aria-label="Remind at" value={reminderWhen} onChange={(e) => setReminderWhen(e.target.value)} />
                <input className="field-input" placeholder={`Message for ${issue.assignedToName ?? 'the assignee'}…`} value={reminderMessage} onChange={(e) => setReminderMessage(e.target.value)} />
              </div>
              <button
                onClick={() => scheduleReminderMutation.mutate()}
                disabled={!reminderWhen || !reminderMessage.trim() || scheduleReminderMutation.isPending}
                className="btn-primary"
              >
                {scheduleReminderMutation.isPending ? 'Scheduling…' : 'Schedule reminder'}
              </button>
              {scheduleReminderMutation.isError && <p className="field-error">{apiErrorMessage(scheduleReminderMutation.error)}</p>}
            </>
          )}
        </section>
      )}

      {isManager && forceOpen && (
        <section className="panel p-6 space-y-4 border-danger/30">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Admin override: force status</h2><button onClick={() => setForceOpen(false)} className="btn-ghost">Cancel</button></div>
          <div className="flex flex-wrap items-center gap-2">
            <Listbox aria-label="Force status" className="field-input w-auto" value={forceStatusValue} onChange={(e) => setForceStatusValue(e.target.value as IssueStatus)}>
              <option value="">Force status to…</option>
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Listbox>
            <button onClick={() => forceStatusMutation.mutate()} disabled={!forceStatusValue || forceStatusMutation.isPending} className="btn-danger">
              {forceStatusMutation.isPending ? 'Forcing…' : 'Force'}
            </button>
          </div>
          {forceStatusMutation.isError && <p className="field-error">{apiErrorMessage(forceStatusMutation.error)}</p>}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <section className="panel p-6">
            <h2 className="text-base font-semibold text-ink-100 mb-2">What's wrong</h2>
            <p className="text-sm text-ink-300 whitespace-pre-line max-w-none">{issue.description || 'No description was given.'}</p>
          </section>

          {/* Evidence: F5: at least one evidence capture is required before
              this issue can be closed (enforced server-side; hasEvidence
              above just mirrors it for the Close action's state). */}
          <section className="panel p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink-100">
                Evidence <span className="ml-2 text-xs font-normal text-ink-500">{evidenceQuery.data?.length ?? 0}</span>
              </h2>
              <button onClick={() => setPickerOpen((v) => !v)} className="btn-secondary">
                {pickerOpen ? 'Cancel' : <><PlusIcon /> Attach a capture</>}
              </button>
            </div>
            {!evidenceQuery.isLoading && (evidenceQuery.data?.length ?? 0) === 0 && (
              <p className="text-xs text-ink-500">No evidence attached yet. Required before this issue can be closed.</p>
            )}
            {(evidenceQuery.data?.length ?? 0) > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {evidenceQuery.data!.map((e) => (
                  <div key={e.id} className="space-y-2">
                    {e.thumbnailUrl
                      ? <img src={e.thumbnailUrl} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover rounded-xl border border-ink-100/10" />
                      : <div className="w-full aspect-[4/3] rounded-xl bg-base-700 border border-ink-100/10" />}
                    <div className="text-xs text-ink-500 truncate">{e.title ?? e.addedByName}</div>
                  </div>
                ))}
              </div>
            )}
            {pickerOpen && <EvidencePicker projectId={projectId} issueId={issueId} onDone={() => setPickerOpen(false)} />}

            {/* Photos from the pin this issue was raised from; distinct from
                the evidence above (issue_captures, manually attached). */}
            {issue.locationId && (pinCapturesQuery.data?.data.length ?? 0) > 0 && (
              <div className="pt-4 border-t border-ink-100/10">
                <div className="field-label">Photos from the pin ({pinCapturesQuery.data!.data.length})</div>
                <CaptureGrid projectId={projectId} captures={pinCapturesQuery.data!.data} />
              </div>
            )}
            {/* View-state screenshot, captured automatically when the issue was raised from the viewer. */}
            {issue.screenshotUrl && (
              <div className="pt-4 border-t border-ink-100/10">
                <div className="field-label">3D view at time of report</div>
                <img src={issue.screenshotUrl} alt="BIM viewer screenshot captured when this issue was raised" loading="lazy" className="w-full max-w-md rounded-xl border border-ink-100/10" />
              </div>
            )}
          </section>

          <Collapsible title="Activity & comments" count={activitiesQuery.data?.length ?? 0}>
            <div className="space-y-2 mb-4">
              {(activitiesQuery.data ?? []).map((a) => (
                <div key={a.id} className="rounded-xl bg-ink-100/[0.03] border border-ink-100/10 p-4 text-sm">
                  <div className="flex items-center gap-2 text-xs text-ink-500 mb-2">
                    <span className="font-medium text-ink-300">{a.performedByName ?? 'Someone'}</span>
                    <span>{activityLabel(a.activityType, a.fromValue, a.toValue)}</span>
                    <span className="ml-auto">{formatDateTime(a.createdAt)}</span>
                  </div>
                  {a.content && <p className="text-ink-100">{a.content}</p>}
                  {a.attachmentName && (
                    a.attachmentReadUrl ? (
                      <a href={a.attachmentReadUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 text-xs text-blueprint hover:text-blueprint-hover bg-base-700/40 rounded px-2 py-2 w-fit">
                        <PaperclipIcon />
                        <span className="underline">{a.attachmentName}</span>
                        {a.attachmentSizeBytes != null && (
                          // BIGINT columns come back as strings over the wire (node-postgres avoids
                          // precision loss on values outside the JS safe-integer range for BIGINT);
                          // coerce rather than trust the declared `number` type.
                          <span className="text-ink-500">({formatBytes(Number(a.attachmentSizeBytes))})</span>
                        )}
                      </a>
                    ) : (
                      // Defensive fallback: attachmentReadUrl absent: render name+size as plain,
                      // non-clickable text instead of a dead link.
                      <div className="mt-2 flex items-center gap-2 text-xs text-ink-300 bg-base-700/40 rounded px-2 py-2 w-fit">
                        <PaperclipIcon />
                        <span>{a.attachmentName}</span>
                        {a.attachmentSizeBytes != null && <span className="text-ink-500">({formatBytes(Number(a.attachmentSizeBytes))})</span>}
                      </div>
                    )
                  )}
                </div>
              ))}
              {activitiesQuery.data?.length === 0 && <p className="text-sm text-ink-500">No activity yet.</p>}
            </div>
            <div className="flex gap-2 mb-2">
              <input
                className="field-input"
                placeholder="Add a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) commentMutation.mutate(); }}
              />
              <button onClick={() => commentMutation.mutate()} disabled={!comment.trim() || commentMutation.isPending} className="btn-primary">Send</button>
            </div>
            {commentMutation.isError && <p className="field-error">{apiErrorMessage(commentMutation.error)}</p>}
            <div className="flex items-center gap-2">
              <input className="field-input flex-1" placeholder="Attachment note (optional)…" value={attachComment} onChange={(e) => setAttachComment(e.target.value)} />
              <label className="btn-secondary cursor-pointer shrink-0">
                {attachMutation.isPending ? 'Uploading…' : 'Attach file'}
                <input
                  type="file"
                  className="hidden"
                  disabled={attachMutation.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) attachMutation.mutate(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {attachMutation.isError && <p className="field-error">{apiErrorMessage(attachMutation.error)}</p>}
          </Collapsible>

          {/* Email history: Phase 3G */}
          <Collapsible title="Email history">
            <EmailHistoryList projectId={projectId} relatedRecordType="issue" relatedRecordId={issueId} />
          </Collapsible>
        </div>

        <aside className="space-y-6 min-w-0">
          <section className="panel p-6">
            <h2 className="text-base font-semibold text-ink-100 mb-2">Details</h2>
            <dl className="divide-y divide-ink-100/10">
              <DetailRow label="Assignee" value={issue.assignedToName ?? <span className="text-ink-500 font-normal">Not assigned</span>} />
              <DetailRow label="Due" value={<span className={timer.state === 'overdue' ? 'text-danger' : undefined}>{formatDeadline(issue.deadline)}</span>} />
              <DetailRow label="Type" value={ISSUE_TYPE_LABELS[issue.issueType]} />
              {issue.category && <DetailRow label="Category" value={CATEGORY_LABELS[issue.category]} />}
              <DetailRow
                label="Location"
                value={
                  issue.drawingId && issue.locationId ? (
                    <Link to={`/projects/${projectId}/drawings?drawingId=${issue.drawingId}&pinId=${issue.locationId}`} className="text-blueprint hover:text-blueprint-hover">
                      {issue.locationName ?? issue.buildingName ?? 'View pin'}: view on floor plan
                    </Link>
                  ) : (
                    issue.locationName ?? issue.buildingName ?? '—'
                  )
                }
              />
              {issue.elementName && (
                <DetailRow
                  label="BIM element"
                  value={
                    issue.elementModelId && issue.elementGuid ? (
                      <Link to={viewIn3dUrl(projectId, issue)} className="text-blueprint hover:text-blueprint-hover">{issue.elementName}: view in 3D</Link>
                    ) : (
                      issue.elementName
                    )
                  }
                />
              )}
              {!issue.elementName && issue.modelId && hasCameraState(issue) && (
                <DetailRow label="3D view" value={<Link to={viewIn3dUrl(projectId, issue)} className="text-blueprint hover:text-blueprint-hover">Reopen exact view</Link>} />
              )}
              <DetailRow label="Created" value={formatDateTime(issue.createdAt)} />
              {issue.closedAt && <DetailRow label="Closed" value={formatDateTime(issue.closedAt)} />}
            </dl>
          </section>

          {nextStep && (
            <section className="panel p-6 space-y-4" style={{ background: 'linear-gradient(180deg, rgb(var(--rc-signal) / 0.12), rgb(var(--rc-base-800) / 0.78))' }}>
              <h2 className="text-base font-semibold text-ink-100">Next step</h2>
              <p className="text-sm text-ink-300">{nextStep.text}</p>
              <button onClick={nextStep.run} className="btn-primary w-full">{nextStep.action}</button>
            </section>
          )}

          {(pendingRemindersQuery.data?.length ?? 0) > 0 && (
            <section className="panel p-6 space-y-2">
              <h2 className="text-base font-semibold text-ink-100">Scheduled reminders</h2>
              {pendingRemindersQuery.data!.map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="text-ink-500">{formatDateTime(r.scheduledFor)}</div>
                    <div className="text-ink-100">{r.message}</div>
                  </div>
                  <button onClick={() => cancelReminderMutation.mutate(r.id)} disabled={cancelReminderMutation.isPending} className="btn-ghost !px-2 shrink-0">Cancel</button>
                </div>
              ))}
            </section>
          )}

          <InlineRiskAssessment projectId={projectId} nodeType="issue" entityId={issueId} />
        </aside>
      </div>

      <EmailComposerModal
        open={composeEmailOpen}
        onClose={() => setComposeEmailOpen(false)}
        projectId={projectId}
        prefill={{ subject: `${issue.issueNumber ?? ''}: ${issue.title}`.trim(), relatedRecordType: 'issue', relatedRecordId: issue.id }}
      />
    </div>
  );
}

function hasCameraState(issue: IssueDetailItem): boolean {
  return [issue.cameraPosX, issue.cameraPosY, issue.cameraPosZ, issue.cameraTargetX, issue.cameraTargetY, issue.cameraTargetZ]
    .every((v) => typeof v === 'number');
}

// Builds the "view in 3D" link: the model + (if present) the element GUID
// to re-select, plus (if present) the exact camera position/target to
// restore, so the viewer reopens looking at what the reporter actually saw
// rather than only re-selecting the element from its default angle.
function viewIn3dUrl(projectId: string, issue: IssueDetailItem): string {
  const modelId = issue.elementModelId ?? issue.modelId;
  const params = new URLSearchParams();
  if (issue.elementGuid) params.set('guid', issue.elementGuid);
  if (hasCameraState(issue)) {
    params.set('cx', String(issue.cameraPosX));
    params.set('cy', String(issue.cameraPosY));
    params.set('cz', String(issue.cameraPosZ));
    params.set('tx', String(issue.cameraTargetX));
    params.set('ty', String(issue.cameraTargetY));
    params.set('tz', String(issue.cameraTargetZ));
  }
  const query = params.toString();
  return `/projects/${projectId}/bim/${modelId}${query ? `?${query}` : ''}`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-ink-500 shrink-0">{label}</dt>
      <dd className="text-ink-100 font-medium text-right min-w-0 break-words">{value}</dd>
    </div>
  );
}

// A panel whose body opens on demand: secondary information (activity,
// email history) stays one line until someone asks for it.
function activityLabel(type: string, from?: string, to?: string): string {
  if (type === 'status_change') return `changed status: ${from ?? '?'} → ${to ?? '?'}`;
  if (type === 'status_force') return `force-changed status: ${from ?? '?'} → ${to ?? '?'}`;
  if (type === 'capture_added') return 'attached a photo';
  if (type === 'assigned') return 'reassigned the issue';
  if (type === 'closed') return 'closed the issue';
  if (type === 'forward') return 'forwarded the issue';
  if (type === 'reopened') return 'reopened the issue';
  if (type === 'auto_warning') return 'sent an automatic deadline warning';
  if (type === 'manual_warning') return 'sent a manual warning';
  if (type === 'reminder') return 'sent a reminder';
  return 'commented';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EvidencePicker({ projectId, issueId, onDone }: { projectId: string; issueId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const capturesQuery = useQuery({
    queryKey: ['captures', projectId, 'picker'],
    queryFn: () => listCaptures(projectId, { perPage: 30 }),
  });

  const attachMutation = useMutation({
    mutationFn: (captureId: string) => addEvidenceCapture(projectId, issueId, captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-activities', projectId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['issue-evidence', projectId, issueId] });
      onDone();
    },
  });

  return (
    <div className="panel p-4 mb-4 max-h-56 overflow-y-auto">
      {capturesQuery.isLoading && <p className="text-xs text-ink-500">Loading captures…</p>}
      {capturesQuery.data?.data.length === 0 && <p className="text-xs text-ink-500">No captures uploaded on this project yet.</p>}
      <div className="space-y-2">
        {(capturesQuery.data?.data ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => attachMutation.mutate(c.id)}
            disabled={attachMutation.isPending}
            className="w-full text-left text-xs px-2 py-2 rounded hover:bg-base-700 flex items-center justify-between"
          >
            <span className="truncate">{c.title || c.captureType}</span>
            <span className="text-ink-500 shrink-0 ml-2">{new Date(c.capturedAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Icon({ d, className = 'w-5 h-5' }: { d: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const ChevronIcon = ({ className = 'w-4 h-4 opacity-70' }: { className?: string }) => <Icon d="M6 9l6 6 6-6" className={className} />;
const PinIcon = () => <Icon d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" className="w-5 h-5 text-ink-500 shrink-0" />;
const PlusIcon = () => <Icon d="M12 5v14M5 12h14" className="w-4 h-4" />;
const EditIcon = () => <Icon d="M4 20h4L19 9l-4-4L4 16v4z" />;
const MailIcon = () => <Icon d="M3 7l9 6 9-6M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />;
const ForwardIcon = () => <Icon d="M14 6l6 6-6 6M20 12H9a5 5 0 0 0-5 5v1" />;
const BellIcon = () => <Icon d="M6 9a6 6 0 1 1 12 0c0 3.5.8 5.6 1.6 6.8.4.6 0 1.2-.7 1.2H5.1c-.7 0-1.1-.6-.7-1.2C5.2 14.6 6 12.5 6 9zM10 20a2.2 2.2 0 0 0 4 0" />;
const SparkIcon = () => <Icon d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />;
const DownloadIcon = () => <Icon d="M12 4v11M7 10l5 5 5-5M5 20h14" />;
const TrashIcon = () => <Icon d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />;
function DotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.5l-8.5 8.5a4 4 0 01-5.7-5.7L15.3 6.8a2.7 2.7 0 013.8 3.8L10.6 19a1.3 1.3 0 01-1.9-1.9l7.5-7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
