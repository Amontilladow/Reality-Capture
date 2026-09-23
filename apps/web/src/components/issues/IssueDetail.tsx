import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getIssue, updateIssue, closeIssue, deleteIssue, getActivities, addComment, addEvidenceCapture,
  forwardIssue, forceIssueStatus, uploadIssueAttachment, downloadIssuePdf, downloadIssueXls,
  scheduleIssueReminder, listPendingIssueReminders, cancelIssueReminder,
  type IssueDetailItem,
} from '../../lib/issues.api';
import { listCaptures } from '../../lib/captures.api';
import { CaptureGrid } from '../CaptureGrid';
import { getMembers } from '../../lib/projects.api';
import { useAuthStore } from '../../store/auth.store';
import {
  STATUS_LABELS, STATUS_BADGE_CLASS, PRIORITY_LABELS, PRIORITY_BADGE_CLASS,
  ISSUE_TYPE_LABELS, ISSUE_STATUS_FLOW, ISSUE_STATUSES, DISCIPLINE_LABELS, CATEGORY_LABELS,
  getDeadlineTimer, TIMER_BADGE_CLASS, formatDeadline, formatDateTime, isIssueManager,
} from '../../lib/issue-constants';
import { apiErrorMessage } from '../../lib/api';
import type { IssueStatus } from '@engineeringos/types';

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

  // Photos/videos from the pin this issue was raised from, if any -- same
  // captures.location_id relationship PinPanel.tsx's own "History" grid
  // reads, so the two stay in sync automatically (adding a photo from
  // either side shows up in both). Distinct from the "Evidence photos"
  // section below (issue_captures, manually attached, unrelated pin or not).
  const pinCapturesQuery = useQuery({
    queryKey: ['captures', projectId, 'pin', issueQuery.data?.locationId],
    queryFn: () => listCaptures(projectId, { locationId: issueQuery.data!.locationId, perPage: 50 }),
    enabled: Boolean(issueQuery.data?.locationId),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['issue', projectId, issueId] });
    queryClient.invalidateQueries({ queryKey: ['issue-activities', projectId, issueId] });
    queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
    queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
  }

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateIssue(projectId, issueId, { status: status as never }),
    onSuccess: invalidateAll,
  });

  // Separate from statusMutation -- 'closed' is no longer a status
  // updateIssue() can set at all; only the creator (or an admin) may
  // close, enforced server-side by IssuesService.close().
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
  // forward()): closing is creator-or-admin; forwarding is the current
  // assignee (or the creator, if the issue is still unassigned) or admin.
  const isCreator = currentUser?.id === issue.createdBy;
  const isCurrentAssignee = Boolean(currentUser?.id && currentUser.id === issue.assignedTo);
  const canClose = isCreator || isManager;
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

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <button onClick={onBack} className="btn-ghost !px-2 !py-1 text-xs">
        <BackIcon /> Back to issues
      </button>

      {/* Status stepper — 'reopened' is a distinct terminal-ish state, shown
          as its own badge below rather than inserted into this linear flow. */}
      <div className="space-y-2">
        {ISSUE_STATUS_FLOW.includes(issue.status) && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {ISSUE_STATUS_FLOW.map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className={`px-2 py-1 rounded-sm font-mono uppercase tracking-wide ${
                    i === currentStepIdx ? 'bg-signal text-base-950 font-semibold' : i < currentStepIdx ? 'bg-ok/15 text-ok' : 'bg-base-700 text-ink-500'
                  }`}
                >
                  {STATUS_LABELS[s]}
                </span>
                {i < ISSUE_STATUS_FLOW.length - 1 && <span className="text-ink-500">→</span>}
              </span>
            ))}
          </div>
        )}
        {issue.status === 'reopened' && (
          <span className="badge bg-danger/15 text-danger">↺ Reopened — outside the normal status flow</span>
        )}
      </div>

      {/* Header card */}
      <div className="panel tick-frame p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] font-mono text-ink-500 mb-1">{issue.issueNumber ?? issue.id}</div>
            <h2 className="text-lg font-semibold mb-2">{issue.title}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${STATUS_BADGE_CLASS[issue.status]}`}>{STATUS_LABELS[issue.status]}</span>
              <span className={`badge ${PRIORITY_BADGE_CLASS[issue.priority]}`}>{PRIORITY_LABELS[issue.priority]}</span>
              <span className={`badge ${TIMER_BADGE_CLASS[timer.state]}`} title={`Due ${formatDeadline(issue.deadline)}`}>
                {timer.label}
              </span>
              {issue.discipline && <span className="badge bg-base-700 text-ink-500">{DISCIPLINE_LABELS[issue.discipline]}</span>}
              {issue.category && <span className="badge bg-base-700 text-ink-500">{CATEGORY_LABELS[issue.category]}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <button onClick={() => onEdit(issue)} className="btn-secondary !px-3 !py-1.5 text-xs">Edit</button>
            {canForward && (
              <button onClick={() => setForwardOpen((v) => !v)} className="btn-secondary !px-3 !py-1.5 text-xs">
                {forwardOpen ? 'Cancel forward' : 'Forward'}
              </button>
            )}
            <button onClick={() => setReminderOpen((v) => !v)} className="btn-secondary !px-3 !py-1.5 text-xs">
              {reminderOpen ? 'Cancel reminder' : 'Remind…'}
            </button>
            <button onClick={handleDownloadPdf} disabled={downloading === 'pdf'} className="btn-secondary !px-3 !py-1.5 text-xs">
              {downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}
            </button>
            <button onClick={handleDownloadXls} disabled={downloading === 'xls'} className="btn-secondary !px-3 !py-1.5 text-xs">
              {downloading === 'xls' ? 'Preparing…' : 'Download XLS'}
            </button>
            <button
              onClick={() => { if (confirm('Delete this issue? This cannot be undone.')) deleteMutation.mutate(); }}
              className="btn-danger !px-3 !py-1.5 text-xs"
            >
              Delete
            </button>
          </div>
        </div>
        {downloadError && <p className="field-error">{downloadError}</p>}

        {/* Forward form -- only the current assignee (or, if unassigned, the
            creator) or an admin may forward; mirrors IssuesService.forward(). */}
        {canForward && forwardOpen && (
          <div className="pt-3 border-t border-base-600 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select className="field-input" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)}>
                <option value="">Forward to…</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
                ))}
              </select>
              <input
                className="field-input"
                placeholder="Optional note…"
                value={forwardComment}
                onChange={(e) => setForwardComment(e.target.value)}
              />
            </div>
            <button
              onClick={() => forwardMutation.mutate()}
              disabled={!forwardTo || forwardMutation.isPending}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {forwardMutation.isPending ? 'Forwarding…' : 'Send forward'}
            </button>
            {forwardMutation.isError && <p className="field-error">{apiErrorMessage(forwardMutation.error)}</p>}
          </div>
        )}

        {/* Schedule a reminder -- open to anyone who can view the issue
            (unlike the admin-only, immediate Reminders tab on the list
            page); always targets the current assignee, so it needs one. */}
        {reminderOpen && (
          <div className="pt-3 border-t border-base-600 space-y-2">
            {!issue.assignedTo ? (
              <p className="text-xs text-ink-500">This issue has no assignee yet -- assign it to someone before scheduling a reminder.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="datetime-local"
                    className="field-input"
                    value={reminderWhen}
                    onChange={(e) => setReminderWhen(e.target.value)}
                  />
                  <input
                    className="field-input"
                    placeholder={`Message for ${issue.assignedToName ?? 'the assignee'}…`}
                    value={reminderMessage}
                    onChange={(e) => setReminderMessage(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => scheduleReminderMutation.mutate()}
                  disabled={!reminderWhen || !reminderMessage.trim() || scheduleReminderMutation.isPending}
                  className="btn-primary !px-3 !py-1.5 text-xs"
                >
                  {scheduleReminderMutation.isPending ? 'Scheduling…' : 'Schedule reminder'}
                </button>
                {scheduleReminderMutation.isError && <p className="field-error">{apiErrorMessage(scheduleReminderMutation.error)}</p>}
              </>
            )}
          </div>
        )}

        {/* Pending scheduled reminders on this issue */}
        {(pendingRemindersQuery.data?.length ?? 0) > 0 && (
          <div className="pt-3 border-t border-base-600 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">Scheduled reminders</div>
            {pendingRemindersQuery.data!.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <span className="text-ink-500">{formatDateTime(r.scheduledFor)}</span>
                <span className="text-ink-100">{r.message}</span>
                <button
                  onClick={() => cancelReminderMutation.mutate(r.id)}
                  disabled={cancelReminderMutation.isPending}
                  className="btn-ghost !px-2 !py-0.5 text-xs ml-auto"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Status actions -- 'closed' is deliberately not in this generic
            map: it's the one transition restricted to the creator (or an
            admin), so it gets its own button below with its own mutation
            and a disabled/tooltip state for everyone else. */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-base-600">
          {ISSUE_STATUS_FLOW.filter((s) => s !== issue.status && s !== 'closed').map((s) => (
            <button
              key={s}
              onClick={() => statusMutation.mutate(s)}
              disabled={statusMutation.isPending}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              Move to {STATUS_LABELS[s]}
            </button>
          ))}
          {issue.status !== 'closed' && (
            <button
              onClick={() => closeMutation.mutate()}
              disabled={!canClose || closeMutation.isPending}
              title={canClose ? undefined : 'Only the person who raised this issue (or an administrator) can close it.'}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              {closeMutation.isPending ? 'Closing…' : `Move to ${STATUS_LABELS.closed}`}
            </button>
          )}
          {(issue.status === 'closed' || issue.status === 'resolved') && (
            <button onClick={() => statusMutation.mutate('reopened')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              ↩ Reopen
            </button>
          )}
        </div>
        {closeMutation.isError && <p className="field-error">{apiErrorMessage(closeMutation.error)}</p>}

        {/* Admin force-status override */}
        {isManager && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-base-600">
            <span className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">Admin override</span>
            <select
              className="field-input w-auto"
              value={forceStatusValue}
              onChange={(e) => setForceStatusValue(e.target.value as IssueStatus)}
            >
              <option value="">Force status to…</option>
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <button
              onClick={() => forceStatusMutation.mutate()}
              disabled={!forceStatusValue || forceStatusMutation.isPending}
              className="btn-danger !px-3 !py-1.5 text-xs"
            >
              {forceStatusMutation.isPending ? 'Forcing…' : 'Force'}
            </button>
            {forceStatusMutation.isError && <p className="field-error">{apiErrorMessage(forceStatusMutation.error)}</p>}
          </div>
        )}
      </div>

      {/* Description + details */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="field-label">Description</div>
          <p className="text-sm text-ink-300">{issue.description || '—'}</p>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="field-label">Details</div>
          <DetailRow label="Type" value={ISSUE_TYPE_LABELS[issue.issueType]} />
          {issue.category && <DetailRow label="Category" value={CATEGORY_LABELS[issue.category]} />}
          <DetailRow label="Assignee" value={issue.assignedToName ?? 'Unassigned'} />
          <DetailRow
            label="Location"
            value={
              issue.drawingId && issue.locationId ? (
                <Link
                  to={`/projects/${projectId}/drawings?drawingId=${issue.drawingId}&pinId=${issue.locationId}`}
                  className="text-blueprint hover:text-blueprint-hover"
                >
                  {issue.locationName ?? issue.buildingName ?? 'View pin'} — view on floor plan →
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
                  <Link to={viewIn3dUrl(projectId, issue)} className="text-blueprint hover:text-blueprint-hover">
                    {issue.elementName} — view in 3D →
                  </Link>
                ) : (
                  issue.elementName
                )
              }
            />
          )}
          {!issue.elementName && issue.modelId && hasCameraState(issue) && (
            <DetailRow
              label="3D view"
              value={
                <Link to={viewIn3dUrl(projectId, issue)} className="text-blueprint hover:text-blueprint-hover">
                  Reopen exact view →
                </Link>
              }
            />
          )}
          <DetailRow label="Created" value={formatDateTime(issue.createdAt)} />
          {issue.closedAt && <DetailRow label="Closed" value={formatDateTime(issue.closedAt)} />}
        </div>
      </div>

      {/* View-state screenshot, captured automatically when the issue was raised from the viewer */}
      {issue.screenshotUrl && (
        <div>
          <div className="field-label">3D view at time of report</div>
          <img
            src={issue.screenshotUrl}
            alt="BIM viewer screenshot captured when this issue was raised"
            className="w-full max-w-md rounded border border-base-600"
          />
        </div>
      )}

      {/* Photos from the pin this issue was raised from -- distinct from
          Evidence photos below (issue_captures, manually attached). */}
      {issue.locationId && (pinCapturesQuery.data?.data.length ?? 0) > 0 && (
        <div>
          <div className="field-label">Photos from pin ({pinCapturesQuery.data!.data.length})</div>
          <CaptureGrid projectId={projectId} captures={pinCapturesQuery.data!.data} />
        </div>
      )}

      {/* Evidence photos */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="field-label !mb-0">Evidence photos</div>
          <button onClick={() => setPickerOpen((v) => !v)} className="btn-ghost !px-2 !py-1 text-xs">
            {pickerOpen ? 'Cancel' : '+ Attach existing capture'}
          </button>
        </div>
        {pickerOpen && (
          <EvidencePicker
            projectId={projectId}
            issueId={issueId}
            onDone={() => setPickerOpen(false)}
          />
        )}
      </div>

      {/* Activity / comments */}
      <div>
        <div className="field-label">Activity ({activitiesQuery.data?.length ?? 0})</div>
        <div className="space-y-2 mb-3">
          {(activitiesQuery.data ?? []).map((a) => (
            <div key={a.id} className="panel p-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-ink-500 mb-1">
                <span className="font-medium text-ink-300">{a.performedByName ?? 'Someone'}</span>
                <span>·</span>
                <span>{activityLabel(a.activityType, a.fromValue, a.toValue)}</span>
                <span className="ml-auto">{formatDateTime(a.createdAt)}</span>
              </div>
              {a.content && <p className="text-ink-100">{a.content}</p>}
              {a.attachmentName && (
                a.attachmentReadUrl ? (
                  <a
                    href={a.attachmentReadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 flex items-center gap-1.5 text-xs text-blueprint hover:text-blueprint-hover bg-base-700/40 rounded px-2 py-1 w-fit"
                  >
                    <PaperclipIcon />
                    <span className="underline">{a.attachmentName}</span>
                    {a.attachmentSizeBytes != null && (
                      // BIGINT columns come back as strings over the wire (node-postgres avoids
                      // precision loss on values outside the JS safe-integer range for BIGINT) —
                      // coerce rather than trust the declared `number` type.
                      <span className="text-ink-500">({formatBytes(Number(a.attachmentSizeBytes))})</span>
                    )}
                  </a>
                ) : (
                  // Defensive fallback: attachmentReadUrl absent (shouldn't happen after the
                  // backend fix, but attachmentUrl alone is a raw storage key, not a usable
                  // link) -- render name+size as plain, non-clickable text instead of a dead link.
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-300 bg-base-700/40 rounded px-2 py-1 w-fit">
                    <PaperclipIcon />
                    <span>{a.attachmentName}</span>
                    {a.attachmentSizeBytes != null && (
                      <span className="text-ink-500">({formatBytes(Number(a.attachmentSizeBytes))})</span>
                    )}
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
          <button onClick={() => commentMutation.mutate()} disabled={!comment.trim() || commentMutation.isPending} className="btn-primary !px-4">
            Send
          </button>
        </div>
        {commentMutation.isError && <p className="field-error">{apiErrorMessage(commentMutation.error)}</p>}

        {/* File attachment upload */}
        <div className="flex items-center gap-2">
          <input
            className="field-input flex-1"
            placeholder="Attachment note (optional)…"
            value={attachComment}
            onChange={(e) => setAttachComment(e.target.value)}
          />
          <label className="btn-secondary !px-3 !py-1.5 text-xs cursor-pointer shrink-0">
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
      </div>
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
    <div className="flex gap-2">
      <span className="text-ink-500 w-24 shrink-0">{label}</span>
      <span className="text-ink-100 font-medium">{value}</span>
    </div>
  );
}

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
      onDone();
    },
  });

  return (
    <div className="panel p-3 mb-3 max-h-56 overflow-y-auto">
      {capturesQuery.isLoading && <p className="text-xs text-ink-500">Loading captures…</p>}
      {capturesQuery.data?.data.length === 0 && <p className="text-xs text-ink-500">No captures uploaded on this project yet.</p>}
      <div className="space-y-1">
        {(capturesQuery.data?.data ?? []).map((c) => (
          <button
            key={c.id}
            onClick={() => attachMutation.mutate(c.id)}
            disabled={attachMutation.isPending}
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-base-700 flex items-center justify-between"
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
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.5l-8.5 8.5a4 4 0 01-5.7-5.7L15.3 6.8a2.7 2.7 0 013.8 3.8L10.6 19a1.3 1.3 0 01-1.9-1.9l7.5-7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
