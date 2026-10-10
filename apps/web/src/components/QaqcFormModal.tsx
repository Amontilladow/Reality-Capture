import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, type RfiDiscipline } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { createQaqcRecord, type QaqcRecordType, type QaqcPriority } from '../lib/qaqc.api';
import { QAQC_PRIORITIES, QAQC_PRIORITY_LABELS, QAQC_RECORD_TYPE_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS } from '../lib/qaqc-constants';
import type { ProjectMember } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

// Field set deliberately mirrors RfiFormModal's "subject/question(->description)/
// priority/discipline+disciplineOther/assignedTo/dueDate" shape -- see
// create-qaqc-record.dto.ts's own comment for why RFI's cost/time/
// drawing-impact fields have no NCR/SOR equivalent here.
export function QaqcFormModal({
  open, onClose, projectId, recordType, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  recordType: QaqcRecordType;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<QaqcPriority>('medium');
  const [discipline, setDiscipline] = useState<RfiDiscipline | ''>('');
  const [disciplineOther, setDisciplineOther] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setSubject(''); setDescription(''); setPriority('medium');
    setDiscipline(''); setDisciplineOther('');
    setAssignedTo(''); setDueDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!subject.trim()) throw new Error('Subject is required.');
      if (!description.trim()) throw new Error('Description is required.');
      if (!discipline) throw new Error('Discipline is required.');
      if (discipline === 'other' && !disciplineOther.trim()) throw new Error('Please specify the discipline.');
      return createQaqcRecord(projectId, {
        recordType,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        discipline,
        disciplineOther: discipline === 'other' ? disciplineOther.trim() : undefined,
        assignedTo: assignedTo || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qaqc-records', projectId] });
      queryClient.invalidateQueries({ queryKey: ['qaqc-summary', projectId] });
      reset();
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function handleClose() {
    reset();
    onClose();
  }

  const shortLabel = QAQC_RECORD_TYPE_SHORT_LABELS[recordType];

  return (
    <Modal open={open} onClose={handleClose} title={`New ${shortLabel}`}>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">{QAQC_RECORD_TYPE_LABELS[recordType]}</p>
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="qaqc-subject">Subject *</label>
          <input id="qaqc-subject" className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`What is this ${shortLabel} about?`} />
        </div>

        <div>
          <label className="field-label" htmlFor="qaqc-description">Description *</label>
          <textarea
            id="qaqc-description"
            className="field-input min-h-[96px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={recordType === 'ncr' ? 'Describe the non-conformance…' : 'Describe the observation…'}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="qaqc-priority">Priority</label>
            <select id="qaqc-priority" className="field-input" value={priority} onChange={(e) => setPriority(e.target.value as QaqcPriority)}>
              {QAQC_PRIORITIES.map((p) => (
                <option key={p} value={p}>{QAQC_PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="qaqc-dueDate">Due date</label>
            <input id="qaqc-dueDate" type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="qaqc-assignedTo">Assignee</label>
            <select id="qaqc-assignedTo" className="field-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="qaqc-discipline">Discipline *</label>
            <select id="qaqc-discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value as RfiDiscipline)}>
              <option value="">Select…</option>
              {RFI_DISCIPLINES.map((d) => (
                <option key={d} value={d}>{RFI_DISCIPLINE_LABELS[d]}</option>
              ))}
            </select>
          </div>
        </div>

        {discipline === 'other' && (
          <div>
            <label className="field-label" htmlFor="qaqc-disciplineOther">Please specify *</label>
            <input id="qaqc-disciplineOther" className="field-input" value={disciplineOther} onChange={(e) => setDisciplineOther(e.target.value)} />
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : `Create ${shortLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
