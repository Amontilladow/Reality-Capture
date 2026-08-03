import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RfiPriority } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { createRfi } from '../lib/rfis.api';
import type { ProjectMember } from '../lib/projects.api';
import { RFI_PRIORITIES, RFI_PRIORITY_LABELS } from '../lib/rfi-constants';
import { apiErrorMessage } from '../lib/api';

export function RfiFormModal({
  open, onClose, projectId, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [priority, setPriority] = useState<RfiPriority>('medium');
  const [discipline, setDiscipline] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setSubject(''); setQuestion(''); setPriority('medium');
    setDiscipline(''); setAssignedTo(''); setDueDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!subject.trim()) throw new Error('Subject is required.');
      if (!question.trim()) throw new Error('Question is required.');
      return createRfi(projectId, {
        subject: subject.trim(),
        question: question.trim(),
        priority,
        discipline: discipline || undefined,
        assignedTo: assignedTo || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
      reset();
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="New RFI">
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="subject">Subject *</label>
          <input id="subject" className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is this RFI about?" />
        </div>

        <div>
          <label className="field-label" htmlFor="question">Question *</label>
          <textarea id="question" className="field-input min-h-[88px]" value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="priority">Priority</label>
            <select id="priority" className="field-input" value={priority} onChange={(e) => setPriority(e.target.value as RfiPriority)}>
              {RFI_PRIORITIES.map((p) => (
                <option key={p} value={p}>{RFI_PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="dueDate">Due date</label>
            <input id="dueDate" type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="assignedTo">Assignee</label>
            <select id="assignedTo" className="field-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="discipline">Discipline</label>
            <input id="discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="MEP, Structural…" />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Create RFI'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
