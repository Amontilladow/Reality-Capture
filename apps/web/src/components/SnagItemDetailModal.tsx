import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { updateSnagItem, deleteSnagItem, type SnagListItem } from '../lib/snagging.api';
import {
  SNAG_STATUS_LABELS, SNAG_STATUS_BADGE_CLASS, SNAG_PRIORITY_LABELS, SNAG_PRIORITY_BADGE_CLASS, formatDate,
} from '../lib/snagging-constants';
import { apiErrorMessage } from '../lib/api';

export function SnagItemDetailModal({
  open, onClose, projectId, snag,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  snag: SnagListItem | null;
}) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['snag-items', projectId] });
    queryClient.invalidateQueries({ queryKey: ['snag-summary', projectId] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateSnagItem(projectId, snag!.id, { status: status as never }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSnagItem(projectId, snag!.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  if (!snag) return null;

  return (
    <Modal open={open} onClose={onClose} title={snag.snagNumber ?? 'Snag item'} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${SNAG_STATUS_BADGE_CLASS[snag.status]}`}>{SNAG_STATUS_LABELS[snag.status]}</span>
          <span className={`badge ${SNAG_PRIORITY_BADGE_CLASS[snag.priority]}`}>{SNAG_PRIORITY_LABELS[snag.priority]}</span>
          {snag.trade && <span className="badge bg-base-700 text-ink-500">{snag.trade}</span>}
          {snag.location && <span className="badge bg-base-700 text-ink-500">{snag.location}</span>}
          <span className="text-xs text-ink-500 ml-auto">Due {formatDate(snag.dueDate)}</span>
        </div>

        <h3 className="text-base font-semibold">{snag.title}</h3>

        {snag.description && (
          <div>
            <div className="field-label">Description</div>
            <p className="text-sm text-ink-300 whitespace-pre-wrap">{snag.description}</p>
          </div>
        )}

        <div className="text-xs text-ink-500 flex gap-4 flex-wrap">
          <span>Raised by {snag.createdByName ?? '—'}</span>
          <span>Assigned to {snag.assignedToName ?? 'Unassigned'}</span>
          {snag.fixedAt && <span>Fixed {formatDate(snag.fixedAt)}</span>}
          {snag.verifiedAt && <span>Verified {formatDate(snag.verifiedAt)}</span>}
        </div>

        {statusMutation.isError && <p className="field-error">{apiErrorMessage(statusMutation.error)}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
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
          <button
            onClick={() => { if (confirm('Delete this snag item?')) deleteMutation.mutate(); }}
            className="btn-danger !px-3 !py-1.5 text-xs ml-auto"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}
