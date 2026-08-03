import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SubmittalPriority } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { createSubmittal } from '../lib/submittals.api';
import type { ProjectMember } from '../lib/projects.api';
import { SUBMITTAL_PRIORITIES, SUBMITTAL_PRIORITY_LABELS } from '../lib/submittal-constants';
import { apiErrorMessage } from '../lib/api';

export function SubmittalFormModal({
  open, onClose, projectId, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [specSection, setSpecSection] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<SubmittalPriority>('medium');
  const [discipline, setDiscipline] = useState('');
  const [revision, setRevision] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setTitle(''); setSpecSection(''); setDescription(''); setPriority('medium');
    setDiscipline(''); setRevision(''); setAssignedTo(''); setDueDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Title is required.');
      return createSubmittal(projectId, {
        title: title.trim(),
        specSection: specSection || undefined,
        description: description || undefined,
        priority,
        discipline: discipline || undefined,
        revision: revision || undefined,
        assignedTo: assignedTo || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submittals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['submittal-summary', projectId] });
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
    <Modal open={open} onClose={handleClose} title="New submittal">
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="title">Title *</label>
          <input id="title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Curtain wall shop drawings" />
        </div>

        <div>
          <label className="field-label" htmlFor="description">Description</label>
          <textarea id="description" className="field-input min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="specSection">Spec section</label>
            <input id="specSection" className="field-input" value={specSection} onChange={(e) => setSpecSection(e.target.value)} placeholder="08 44 00" />
          </div>
          <div>
            <label className="field-label" htmlFor="revision">Revision</label>
            <input id="revision" className="field-input" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="Rev A" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="priority">Priority</label>
            <select id="priority" className="field-input" value={priority} onChange={(e) => setPriority(e.target.value as SubmittalPriority)}>
              {SUBMITTAL_PRIORITIES.map((p) => (
                <option key={p} value={p}>{SUBMITTAL_PRIORITY_LABELS[p]}</option>
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
            <label className="field-label" htmlFor="assignedTo">Reviewer</label>
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
            {mutation.isPending ? 'Saving…' : 'Create submittal'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
