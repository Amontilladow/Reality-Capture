import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSnagItem, updateSnagItem, deleteSnagItem, getSnagActivities, addSnagComment,
  forwardSnag, forceSnagStatus, uploadSnagAttachment,
  type SnagListItem,
} from '../lib/snagging.api';
import { getMembers } from '../lib/projects.api';
import { useAuthStore } from '../store/auth.store';
import {
  SNAG_STATUS_LABELS, SNAG_STATUS_BADGE_CLASS, SNAG_PRIORITY_LABELS, SNAG_PRIORITY_BADGE_CLASS,
  SNAG_STATUSES, getSnagDeadlineTimer, TIMER_BADGE_CLASS, isSnagManager, formatDate, formatDateTime,
} from '../lib/snagging-constants';
import { apiErrorMessage } from '../lib/api';
import type { SnagStatus } from '@engineeringos/types';

export function SnagDetail({
  projectId,
  snagId,
  onBack,
  onEdit,
}: {
  projectId: string;
  snagId: string;
  onBack: () => void;
  onEdit: (snag: SnagListItem) => void;
}) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isManager = isSnagManager(currentUser?.companyRole);

  const [comment, setComment] = useState('');
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardComment, setForwardComment] = useState('');
  const [forceStatusValue, setForceStatusValue] = useState<SnagStatus | ''>('');
  const [attachComment, setAttachComment] = useState('');

  const snagQuery = useQuery({
    queryKey: ['snag', projectId, snagId],
    queryFn: () => getSnagItem(projectId, snagId),
  });

  const activitiesQuery = useQuery({
    queryKey: ['snag-activities', projectId, snagId],
    queryFn: () => getSnagActivities(projectId, snagId),
  });

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['snag', projectId, snagId] });
    queryClient.invalidateQueries({ queryKey: ['snag-activities', projectId, snagId] });
    queryClient.invalidateQueries({ queryKey: ['snag-items', projectId] });
    queryClient.invalidateQueries({ queryKey: ['snag-summary', projectId] });
  }

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateSnagItem(projectId, snagId, { status: status as never }),
    onSuccess: invalidateAll,
  });

  const commentMutation = useMutation({
    mutationFn: () => addSnagComment(projectId, snagId, comment.trim()),
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['snag-activities', projectId, snagId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSnagItem(projectId, snagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snag-items', projectId] });
      queryClient.invalidateQueries({ queryKey: ['snag-summary', projectId] });
      onBack();
    },
  });

  const forwardMutation = useMutation({
    mutationFn: () => forwardSnag(projectId, snagId, { toUserId: forwardTo, comment: forwardComment || undefined }),
    onSuccess: () => {
      setForwardOpen(false);
      setForwardTo('');
      setForwardComment('');
      invalidateAll();
    },
  });

  const forceStatusMutation = useMutation({
    mutationFn: () => forceSnagStatus(projectId, snagId, forceStatusValue as SnagStatus),
    onSuccess: () => {
      setForceStatusValue('');
      invalidateAll();
    },
  });

  const attachMutation = useMutation({
    mutationFn: (file: File) => uploadSnagAttachment(projectId, snagId, file, attachComment || undefined),
    onSuccess: () => {
      setAttachComment('');
      queryClient.invalidateQueries({ queryKey: ['snag-activities', projectId, snagId] });
    },
  });

  const snag = snagQuery.data;

  if (snagQuery.isLoading) return <div className="p-6 text-sm text-ink-500">Loading…</div>;
  if (!snag) return <div className="p-6 text-sm text-danger">Snag item not found.</div>;

  const timer = getSnagDeadlineTimer(snag.dueDate, snag.status);
  const members = membersQuery.data ?? [];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <button onClick={onBack} className="btn-ghost !px-2 !py-1 text-xs">
        <BackIcon /> Back to snagging
      </button>

      {/* Header card */}
      <div className="panel tick-frame p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] font-mono text-ink-500 mb-1">{snag.snagNumber ?? snag.id}</div>
            <h2 className="text-lg font-semibold mb-2">{snag.title}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${SNAG_STATUS_BADGE_CLASS[snag.status]}`}>{SNAG_STATUS_LABELS[snag.status]}</span>
              <span className={`badge ${SNAG_PRIORITY_BADGE_CLASS[snag.priority]}`}>{SNAG_PRIORITY_LABELS[snag.priority]}</span>
              <span className={`badge ${TIMER_BADGE_CLASS[timer.state]}`} title={`Due ${formatDate(snag.dueDate)}`}>
                {timer.label}
              </span>
              {snag.trade && <span className="badge bg-base-700 text-ink-500">{snag.trade}</span>}
              {snag.location && <span className="badge bg-base-700 text-ink-500">{snag.location}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <button onClick={() => onEdit(snag)} className="btn-secondary !px-3 !py-1.5 text-xs">Edit</button>
            <button onClick={() => setForwardOpen((v) => !v)} className="btn-secondary !px-3 !py-1.5 text-xs">
              {forwardOpen ? 'Cancel forward' : 'Forward'}
            </button>
            <button
              onClick={() => { if (confirm('Delete this snag item? This cannot be undone.')) deleteMutation.mutate(); }}
              className="btn-danger !px-3 !py-1.5 text-xs"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Forward form */}
        {forwardOpen && (
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

        {/* Status actions -- snagging's two-step closure (fixed -> verified)
            is simpler than Issues' linear flow, so this ports the same three
            conditional buttons the old SnagItemDetailModal used, rather than
            a full stepper. */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-base-600">
          {snag.status === 'open' && (
            <button onClick={() => statusMutation.mutate('fixed')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Mark as fixed
            </button>
          )}
          {snag.status === 'fixed' && (
            <button onClick={() => statusMutation.mutate('verified')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Verify
            </button>
          )}
          {snag.status !== 'void' && (
            <button onClick={() => statusMutation.mutate('void')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Void
            </button>
          )}
        </div>
        {statusMutation.isError && <p className="field-error">{apiErrorMessage(statusMutation.error)}</p>}

        {/* Admin force-status override */}
        {isManager && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-base-600">
            <span className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">Admin override</span>
            <select
              className="field-input w-auto"
              value={forceStatusValue}
              onChange={(e) => setForceStatusValue(e.target.value as SnagStatus)}
            >
              <option value="">Force status to…</option>
              {SNAG_STATUSES.map((s) => (
                <option key={s} value={s}>{SNAG_STATUS_LABELS[s]}</option>
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
          <p className="text-sm text-ink-300">{snag.description || '—'}</p>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="field-label">Details</div>
          <DetailRow label="Trade" value={snag.trade || '—'} />
          <DetailRow label="Location" value={snag.location || '—'} />
          <DetailRow label="Raised by" value={snag.createdByName ?? '—'} />
          <DetailRow label="Assignee" value={snag.assignedToName ?? 'Unassigned'} />
          <DetailRow label="Due" value={formatDate(snag.dueDate)} />
          {snag.fixedAt && <DetailRow label="Fixed" value={formatDateTime(snag.fixedAt)} />}
          {snag.verifiedAt && <DetailRow label="Verified" value={formatDateTime(snag.verifiedAt)} />}
        </div>
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
                <span>{snagActivityLabel(a.activityType, a.fromValue, a.toValue)}</span>
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
                      <span className="text-ink-500">({formatBytes(Number(a.attachmentSizeBytes))})</span>
                    )}
                  </a>
                ) : (
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-ink-500 w-24 shrink-0">{label}</span>
      <span className="text-ink-100 font-medium">{value}</span>
    </div>
  );
}

function snagActivityLabel(type: string, from?: string, to?: string): string {
  if (type === 'status_change') return `changed status: ${from ?? '?'} → ${to ?? '?'}`;
  if (type === 'status_force') return `force-changed status: ${from ?? '?'} → ${to ?? '?'}`;
  if (type === 'forward') return 'forwarded the snag item';
  return 'commented';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
