import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { updateTransmittal, deleteTransmittal, type TransmittalListItem } from '../lib/transmittals.api';
import {
  TRANSMITTAL_STATUS_LABELS, TRANSMITTAL_STATUS_BADGE_CLASS, TRANSMITTAL_PURPOSE_LABELS, formatDate,
} from '../lib/transmittal-constants';
import { apiErrorMessage } from '../lib/api';

export function TransmittalDetailModal({
  open, onClose, projectId, transmittal,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  transmittal: TransmittalListItem | null;
}) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transmittals', projectId] });
    queryClient.invalidateQueries({ queryKey: ['transmittal-summary', projectId] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateTransmittal(projectId, transmittal!.id, { status: status as never }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransmittal(projectId, transmittal!.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  if (!transmittal) return null;

  return (
    <Modal open={open} onClose={onClose} title={transmittal.transmittalNumber ?? 'Transmittal'} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${TRANSMITTAL_STATUS_BADGE_CLASS[transmittal.status]}`}>{TRANSMITTAL_STATUS_LABELS[transmittal.status]}</span>
          <span className="badge bg-base-700 text-ink-500">{TRANSMITTAL_PURPOSE_LABELS[transmittal.purpose]}</span>
          {transmittal.dueDate && <span className="text-xs text-ink-500 ml-auto">Response due {formatDate(transmittal.dueDate)}</span>}
        </div>

        <h3 className="text-base font-semibold">{transmittal.subject}</h3>

        <div className="text-xs text-ink-500 flex gap-4">
          <span>To {transmittal.recipientName}{transmittal.recipientCompany ? ` (${transmittal.recipientCompany})` : ''}</span>
          <span>From {transmittal.createdByName ?? '—'}</span>
          {transmittal.sentDate && <span>Sent {formatDate(transmittal.sentDate)}</span>}
        </div>

        <div>
          <div className="field-label">Items included</div>
          <p className="text-sm text-ink-300 whitespace-pre-wrap">{transmittal.items}</p>
        </div>

        {transmittal.notes && (
          <div>
            <div className="field-label">Notes</div>
            <p className="text-sm text-ink-300 whitespace-pre-wrap">{transmittal.notes}</p>
          </div>
        )}

        {statusMutation.isError && <p className="field-error">{apiErrorMessage(statusMutation.error)}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          {transmittal.status === 'draft' && (
            <button onClick={() => statusMutation.mutate('sent')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Mark as sent
            </button>
          )}
          {transmittal.status === 'sent' && (
            <button onClick={() => statusMutation.mutate('acknowledged')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Mark as acknowledged
            </button>
          )}
          {transmittal.status !== 'void' && (
            <button onClick={() => statusMutation.mutate('void')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Void
            </button>
          )}
          <button
            onClick={() => { if (confirm('Delete this transmittal?')) deleteMutation.mutate(); }}
            className="btn-danger !px-3 !py-1.5 text-xs ml-auto"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}
