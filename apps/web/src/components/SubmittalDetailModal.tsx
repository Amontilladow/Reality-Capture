import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { EmailComposerModal } from './EmailComposerModal';
import { EmailHistoryList } from './EmailHistoryList';
import { updateSubmittal, deleteSubmittal, type SubmittalListItem } from '../lib/submittals.api';
import {
  SUBMITTAL_STATUS_LABELS, SUBMITTAL_STATUS_BADGE_CLASS,
  SUBMITTAL_PRIORITY_LABELS, SUBMITTAL_PRIORITY_BADGE_CLASS,
  REVIEW_OUTCOMES, formatDate,
} from '../lib/submittal-constants';
import { apiErrorMessage } from '../lib/api';
import { InlineRiskAssessment } from './RiskIntelligenceSection';

export function SubmittalDetailModal({
  open, onClose, projectId, submittal,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  submittal: SubmittalListItem | null;
}) {
  const queryClient = useQueryClient();
  const [comments, setComments] = useState('');
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);

  useEffect(() => {
    setComments(submittal?.reviewComments ?? '');
  }, [submittal]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['submittals', projectId] });
    queryClient.invalidateQueries({ queryKey: ['submittal-summary', projectId] });
  };

  const reviewMutation = useMutation({
    mutationFn: (status: string) => updateSubmittal(projectId, submittal!.id, { status: status as never, reviewComments: comments.trim() || undefined }),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateSubmittal(projectId, submittal!.id, { status: status as never }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSubmittal(projectId, submittal!.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  if (!submittal) return null;

  return (
    <Modal open={open} onClose={onClose} title={submittal.submittalNumber ?? 'Submittal'} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${SUBMITTAL_STATUS_BADGE_CLASS[submittal.status]}`}>{SUBMITTAL_STATUS_LABELS[submittal.status]}</span>
          <span className={`badge ${SUBMITTAL_PRIORITY_BADGE_CLASS[submittal.priority]}`}>{SUBMITTAL_PRIORITY_LABELS[submittal.priority]}</span>
          {submittal.specSection && <span className="badge bg-base-700 text-ink-500">§{submittal.specSection}</span>}
          {submittal.revision && <span className="badge bg-base-700 text-ink-500">{submittal.revision}</span>}
          <button onClick={() => setComposeEmailOpen(true)} className="btn-secondary !px-3 !py-1.5 text-xs ml-auto">Email</button>
          <span className="text-xs text-ink-500">Due {formatDate(submittal.dueDate)}</span>
        </div>

        <h3 className="text-base font-semibold">{submittal.title}</h3>

        {submittal.description && (
          <div>
            <div className="field-label">Description</div>
            <p className="text-sm text-ink-300 whitespace-pre-wrap">{submittal.description}</p>
          </div>
        )}

        <div className="text-xs text-ink-500 flex gap-4">
          <span>Submitted by {submittal.createdByName ?? '—'}</span>
          <span>Reviewer {submittal.assignedToName ?? 'Unassigned'}</span>
        </div>

        <InlineRiskAssessment projectId={projectId} nodeType="submittal" entityId={submittal.id} />

        {/* Email history -- Phase 3G */}
        <div>
          <div className="field-label mb-2">Email History</div>
          <EmailHistoryList projectId={projectId} relatedRecordType="submittal" relatedRecordId={submittal.id} />
        </div>

        <div>
          <label className="field-label" htmlFor="comments">Review comments</label>
          <textarea
            id="comments"
            className="field-input min-h-[80px]"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Notes to accompany the review decision…"
          />
          {reviewMutation.isError && <p className="field-error">{apiErrorMessage(reviewMutation.error)}</p>}
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          {REVIEW_OUTCOMES.map((outcome) => (
            <button
              key={outcome}
              onClick={() => reviewMutation.mutate(outcome)}
              disabled={reviewMutation.isPending || submittal.status === outcome}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              {SUBMITTAL_STATUS_LABELS[outcome]}
            </button>
          ))}
          {submittal.status !== 'under_review' && !REVIEW_OUTCOMES.includes(submittal.status) && (
            <button onClick={() => statusMutation.mutate('under_review')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Start review
            </button>
          )}
          <button
            onClick={() => { if (confirm('Delete this submittal?')) deleteMutation.mutate(); }}
            className="btn-danger !px-3 !py-1.5 text-xs ml-auto"
          >
            Delete
          </button>
        </div>
      </div>

      <EmailComposerModal
        open={composeEmailOpen}
        onClose={() => setComposeEmailOpen(false)}
        projectId={projectId}
        prefill={{ subject: `${submittal.submittalNumber ?? ''}: ${submittal.title}`.trim(), relatedRecordType: 'submittal', relatedRecordId: submittal.id }}
      />
    </Modal>
  );
}
