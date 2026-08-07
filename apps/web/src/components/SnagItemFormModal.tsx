import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SnagPriority } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { createSnagItem } from '../lib/snagging.api';
import type { ProjectMember } from '../lib/projects.api';
import { SNAG_PRIORITIES, SNAG_PRIORITY_LABELS } from '../lib/snagging-constants';
import { apiErrorMessage } from '../lib/api';

export function SnagItemFormModal({
  open, onClose, projectId, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [trade, setTrade] = useState('');
  const [priority, setPriority] = useState<SnagPriority>('medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setTitle(''); setDescription(''); setLocation(''); setTrade('');
    setPriority('medium'); setAssignedTo(''); setDueDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Title is required.');
      return createSnagItem(projectId, {
        title: title.trim(),
        description: description || undefined,
        location: location || undefined,
        trade: trade || undefined,
        priority,
        assignedTo: assignedTo || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snag-items', projectId] });
      queryClient.invalidateQueries({ queryKey: ['snag-summary', projectId] });
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
    <Modal open={open} onClose={handleClose} title="New snag item">
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="title">Title *</label>
          <input id="title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Paint touch-up on corridor wall" />
        </div>

        <div>
          <label className="field-label" htmlFor="description">Description</label>
          <textarea id="description" className="field-input min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="location">Location</label>
            <input id="location" className="field-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Level 2, Unit 204" />
          </div>
          <div>
            <label className="field-label" htmlFor="trade">Trade</label>
            <input id="trade" className="field-input" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Painting, Electrical…" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="priority">Priority</label>
            <select id="priority" className="field-input" value={priority} onChange={(e) => setPriority(e.target.value as SnagPriority)}>
              {SNAG_PRIORITIES.map((p) => (
                <option key={p} value={p}>{SNAG_PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="dueDate">Due date</label>
            <input id="dueDate" type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="assignedTo">Assigned to</label>
          <select id="assignedTo" className="field-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Create snag item'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
