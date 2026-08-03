import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { updateRfi, deleteRfi, type RfiListItem } from '../lib/rfis.api';
import { RFI_STATUS_LABELS, RFI_STATUS_BADGE_CLASS, RFI_PRIORITY_LABELS, RFI_PRIORITY_BADGE_CLASS, formatDate } from '../lib/rfi-constants';
import { apiErrorMessage } from '../lib/api';

export function RfiDetailModal({
  open, onClose, projectId, rfi,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  rfi: RfiListItem | null;
}) {
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    setAnswer(rfi?.answer ?? '');
  }, [rfi]);

  const answerMutation = useMutation({
    mutationFn: () => updateRfi(projectId, rfi!.id, { answer: answer.trim(), status: 'answered' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
      onClose();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateRfi(projectId, rfi!.id, { status: status as never }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRfi(projectId, rfi!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
      onClose();
    },
  });

  if (!rfi) return null;

  return (
    <Modal open={open} onClose={onClose} title={rfi.rfiNumber ?? 'RFI'} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${RFI_STATUS_BADGE_CLASS[rfi.status]}`}>{RFI_STATUS_LABELS[rfi.status]}</span>
          <span className={`badge ${RFI_PRIORITY_BADGE_CLASS[rfi.priority]}`}>{RFI_PRIORITY_LABELS[rfi.priority]}</span>
          {rfi.discipline && <span className="badge bg-base-700 text-ink-500">{rfi.discipline}</span>}
          <span className="text-xs text-ink-500 ml-auto">Due {formatDate(rfi.dueDate)}</span>
        </div>

        <h3 className="text-base font-semibold">{rfi.subject}</h3>

        <div>
          <div className="field-label">Question</div>
          <p className="text-sm text-ink-300 whitespace-pre-wrap">{rfi.question}</p>
        </div>

        <div className="text-xs text-ink-500 flex gap-4">
          <span>Raised by {rfi.createdByName ?? '—'}</span>
          <span>Assigned to {rfi.assignedToName ?? 'Unassigned'}</span>
        </div>

        <div>
          <label className="field-label" htmlFor="answer">Answer</label>
          <textarea
            id="answer"
            className="field-input min-h-[100px]"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write the answer to close this out…"
          />
          {answerMutation.isError && <p className="field-error">{apiErrorMessage(answerMutation.error)}</p>}
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          <button
            onClick={() => answerMutation.mutate()}
            disabled={!answer.trim() || answerMutation.isPending}
            className="btn-primary !px-3 !py-1.5 text-xs"
          >
            {answerMutation.isPending ? 'Saving…' : 'Submit answer'}
          </button>
          {rfi.status !== 'closed' && (
            <button onClick={() => statusMutation.mutate('closed')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Close RFI
            </button>
          )}
          {rfi.status === 'closed' && (
            <button onClick={() => statusMutation.mutate('open')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              ↩ Reopen
            </button>
          )}
          <button
            onClick={() => { if (confirm('Delete this RFI?')) deleteMutation.mutate(); }}
            className="btn-danger !px-3 !py-1.5 text-xs ml-auto"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}
