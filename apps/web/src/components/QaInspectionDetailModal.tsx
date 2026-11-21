import aReject from 'react-useanimations/lib/xOctagon';
import aCheckCircle from 'react-useanimations/lib/checkCircle';
import aAlert from 'react-useanimations/lib/alertCircle';
import aStart from 'react-useanimations/lib/arrowRightCircle';
import { AnimatedButton } from './ui/AnimatedIcon';
import aTrash from 'react-useanimations/lib/trash2';
import { confirmDialog } from '../store/confirm.store';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { updateInspection, deleteInspection, type QaInspectionListItem } from '../lib/qa.api';
import {
  QA_STATUS_LABELS, QA_STATUS_BADGE_CLASS, QA_OUTCOMES, formatDate,
} from '../lib/qa-constants';
import { apiErrorMessage } from '../lib/api';

export function QaInspectionDetailModal({
  open, onClose, projectId, inspection,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  inspection: QaInspectionListItem | null;
}) {
  const queryClient = useQueryClient();
  const [findings, setFindings] = useState('');

  useEffect(() => {
    setFindings(inspection?.findings ?? '');
  }, [inspection]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['qa-inspections', projectId] });
    queryClient.invalidateQueries({ queryKey: ['qa-summary', projectId] });
  };

  const outcomeMutation = useMutation({
    mutationFn: (status: string) => updateInspection(projectId, inspection!.id, { status: status as never, findings: findings.trim() || undefined }),
    onSuccess: invalidate,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateInspection(projectId, inspection!.id, { status: status as never }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteInspection(projectId, inspection!.id),
    onSuccess: () => { invalidate(); onClose(); },
  });

  if (!inspection) return null;

  return (
    <Modal open={open} onClose={onClose} title={inspection.inspectionNumber ?? 'Inspection'} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${QA_STATUS_BADGE_CLASS[inspection.status]}`}>{QA_STATUS_LABELS[inspection.status]}</span>
          {inspection.inspectionType && <span className="badge bg-base-700 text-ink-500">{inspection.inspectionType}</span>}
          {inspection.location && <span className="badge bg-base-700 text-ink-500">{inspection.location}</span>}
          <span className="text-xs text-ink-500 ml-auto">{formatDate(inspection.inspectionDate)}</span>
        </div>

        <h3 className="text-base font-semibold">{inspection.title}</h3>

        <div>
          <div className="field-label">Checklist</div>
          <p className="text-sm text-ink-300 whitespace-pre-wrap">{inspection.checklist}</p>
        </div>

        <div className="text-xs text-ink-500 flex gap-4">
          <span>Created by {inspection.createdByName ?? '—'}</span>
          <span>Inspector {inspection.assignedToName ?? 'Unassigned'}</span>
        </div>

        <div>
          <label className="field-label" htmlFor="findings">Findings</label>
          <textarea
            id="findings"
            className="field-input min-h-[80px]"
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            placeholder="Notes to accompany the outcome…"
          />
          {outcomeMutation.isError && <p className="field-error">{apiErrorMessage(outcomeMutation.error)}</p>}
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          {QA_OUTCOMES.map((outcome) => (
            <AnimatedButton
              key={outcome}
              animation={outcome === 'failed' ? aReject : outcome === 'passed' ? aCheckCircle : aAlert}
              onClick={() => outcomeMutation.mutate(outcome)}
              disabled={outcomeMutation.isPending || inspection.status === outcome}
              className="btn-secondary !px-4 !py-2 "
            >
              {QA_STATUS_LABELS[outcome]}
            </AnimatedButton>
          ))}
          {inspection.status === 'scheduled' && (
            <AnimatedButton animation={aStart} onClick={() => statusMutation.mutate('in_progress')} disabled={statusMutation.isPending} className="btn-secondary !px-4 !py-2 ">
              Start inspection
            </AnimatedButton>
          )}
          <AnimatedButton animation={aTrash} interaction="hover"
            onClick={async () => { if (await confirmDialog('Delete this inspection?')) deleteMutation.mutate(); }}
            className="btn-danger !px-4 !py-2 ml-auto"
          >
            Delete
          </AnimatedButton>
        </div>
      </div>
    </Modal>
  );
}
