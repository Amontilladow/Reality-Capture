import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { createInspection } from '../lib/qa.api';
import type { ProjectMember } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

export function QaInspectionFormModal({
  open, onClose, projectId, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [inspectionType, setInspectionType] = useState('');
  const [location, setLocation] = useState('');
  const [checklist, setChecklist] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setTitle(''); setInspectionType(''); setLocation(''); setChecklist('');
    setAssignedTo(''); setInspectionDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Title is required.');
      if (!checklist.trim()) throw new Error('List what this inspection covers.');
      return createInspection(projectId, {
        title: title.trim(),
        inspectionType: inspectionType || undefined,
        location: location || undefined,
        checklist: checklist.trim(),
        assignedTo: assignedTo || undefined,
        inspectionDate: inspectionDate ? new Date(inspectionDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qa-inspections', projectId] });
      queryClient.invalidateQueries({ queryKey: ['qa-summary', projectId] });
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
    <Modal open={open} onClose={handleClose} title="New inspection">
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="title">Title *</label>
          <input id="title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Level 3 concrete pour" />
        </div>

        <div>
          <label className="field-label" htmlFor="checklist">What's being checked *</label>
          <textarea id="checklist" className="field-input min-h-[72px]" value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={'One per line, e.g.\nRebar spacing per drawing S-201\nFormwork alignment and bracing\nEmbeds and sleeves in place'} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="inspectionType">Type</label>
            <input id="inspectionType" className="field-input" value={inspectionType} onChange={(e) => setInspectionType(e.target.value)} placeholder="Structural, MEP, Final…" />
          </div>
          <div>
            <label className="field-label" htmlFor="location">Location</label>
            <input id="location" className="field-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Level 3, Zone B" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="assignedTo">Inspector</label>
            <select id="assignedTo" className="field-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="inspectionDate">Inspection date</label>
            <input id="inspectionDate" type="date" className="field-input" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Create inspection'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
