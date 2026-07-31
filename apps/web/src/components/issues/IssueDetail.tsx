import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getIssue, updateIssue, deleteIssue, getActivities, addComment, addEvidenceCapture,
  type IssueDetailItem,
} from '../../lib/issues.api';
import { listCaptures } from '../../lib/captures.api';
import {
  STATUS_LABELS, STATUS_BADGE_CLASS, PRIORITY_LABELS, PRIORITY_BADGE_CLASS,
  ISSUE_TYPE_LABELS, ISSUE_STATUS_FLOW, isOverdue, formatDeadline, formatDateTime,
} from '../../lib/issue-constants';
import { apiErrorMessage } from '../../lib/api';

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
  const [comment, setComment] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const issueQuery = useQuery({
    queryKey: ['issue', projectId, issueId],
    queryFn: () => getIssue(projectId, issueId),
  });

  const activitiesQuery = useQuery({
    queryKey: ['issue-activities', projectId, issueId],
    queryFn: () => getActivities(projectId, issueId),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateIssue(projectId, issueId, { status: status as never }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', projectId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['issue-activities', projectId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
    },
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

  const issue = issueQuery.data;

  if (issueQuery.isLoading) return <div className="p-6 text-sm text-ink-500">Loading…</div>;
  if (!issue) return <div className="p-6 text-sm text-danger">Issue not found.</div>;

  const overdue = isOverdue(issue.deadline, issue.status);
  const currentStepIdx = ISSUE_STATUS_FLOW.indexOf(issue.status);

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <button onClick={onBack} className="btn-ghost !px-2 !py-1 text-xs">
        <BackIcon /> Back to issues
      </button>

      {/* Status stepper */}
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

      {/* Header card */}
      <div className="panel tick-frame p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] font-mono text-ink-500 mb-1">{issue.issueNumber ?? issue.id}</div>
            <h2 className="text-lg font-semibold mb-2">{issue.title}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${STATUS_BADGE_CLASS[issue.status]}`}>{STATUS_LABELS[issue.status]}</span>
              <span className={`badge ${PRIORITY_BADGE_CLASS[issue.priority]}`}>{PRIORITY_LABELS[issue.priority]}</span>
              <span className={`badge ${overdue ? 'bg-danger/20 text-danger' : 'bg-base-700 text-ink-500'}`}>
                {overdue ? 'Overdue' : `Due ${formatDeadline(issue.deadline)}`}
              </span>
              {issue.discipline && <span className="badge bg-base-700 text-ink-500">{issue.discipline}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <button onClick={() => onEdit(issue)} className="btn-secondary !px-3 !py-1.5 text-xs">Edit</button>
            <button
              onClick={() => { if (confirm('Delete this issue? This cannot be undone.')) deleteMutation.mutate(); }}
              className="btn-danger !px-3 !py-1.5 text-xs"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Status actions */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-base-600">
          {ISSUE_STATUS_FLOW.filter((s) => s !== issue.status).map((s) => (
            <button
              key={s}
              onClick={() => statusMutation.mutate(s)}
              disabled={statusMutation.isPending}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              Move to {STATUS_LABELS[s]}
            </button>
          ))}
          {issue.status === 'closed' && (
            <button onClick={() => statusMutation.mutate('open')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              ↩ Reopen
            </button>
          )}
        </div>
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
          <DetailRow label="Assignee" value={issue.assignedToName ?? 'Unassigned'} />
          <DetailRow label="Location" value={issue.locationName ?? issue.buildingName ?? '—'} />
          {issue.elementName && (
            <DetailRow
              label="BIM element"
              value={
                issue.elementModelId && issue.elementGuid ? (
                  <Link
                    to={`/projects/${projectId}/bim/${issue.elementModelId}?guid=${issue.elementGuid}`}
                    className="text-blueprint hover:text-blueprint-hover"
                  >
                    {issue.elementName} — view in 3D →
                  </Link>
                ) : (
                  issue.elementName
                )
              }
            />
          )}
          <DetailRow label="Created" value={formatDateTime(issue.createdAt)} />
          {issue.closedAt && <DetailRow label="Closed" value={formatDateTime(issue.closedAt)} />}
        </div>
      </div>

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
            </div>
          ))}
          {activitiesQuery.data?.length === 0 && <p className="text-sm text-ink-500">No activity yet.</p>}
        </div>
        <div className="flex gap-2">
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
      </div>
    </div>
  );
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
  if (type === 'capture_added') return 'attached a photo';
  if (type === 'assigned') return 'reassigned the issue';
  if (type === 'closed') return 'closed the issue';
  return 'commented';
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
