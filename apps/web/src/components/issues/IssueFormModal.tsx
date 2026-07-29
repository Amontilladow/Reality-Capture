import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueType, IssuePriority } from '@engineeringos/types';
import { Modal } from '../ui/Modal';
import { createIssue, updateIssue, type IssueDetailItem } from '../../lib/issues.api';
import type { ProjectMember } from '../../lib/projects.api';
import type { ProjectHierarchy } from '../../lib/projects.api';
import { ISSUE_TYPES, ISSUE_TYPE_LABELS, ISSUE_PRIORITIES, PRIORITY_LABELS } from '../../lib/issue-constants';
import { apiErrorMessage } from '../../lib/api';

export function IssueFormModal({
  open,
  onClose,
  projectId,
  members,
  hierarchy,
  issue,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
  hierarchy: ProjectHierarchy[];
  issue?: IssueDetailItem;
}) {
  const isEdit = Boolean(issue);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState<IssueType>('defect');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [discipline, setDiscipline] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [locationId, setLocationId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(issue?.title ?? '');
    setDescription(issue?.description ?? '');
    setIssueType(issue?.issueType ?? 'defect');
    setPriority(issue?.priority ?? 'medium');
    setDiscipline(issue?.discipline ?? '');
    setAssignedTo(issue?.assignedTo ?? '');
    setLocationId(issue?.locationId ?? '');
    setDeadline(issue?.deadline ? issue.deadline.slice(0, 10) : '');
    setError('');
  }, [open, issue]);

  const allLocations = hierarchy.flatMap((b) => (b.levels ?? []).flatMap((l) => l.locations ?? []));

  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required.');
      if (isEdit && issue) {
        return updateIssue(projectId, issue.id, {
          title: title.trim(),
          description: description || undefined,
          priority,
          discipline: discipline || undefined,
          assignedTo: assignedTo || undefined,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
        });
      }
      return createIssue(projectId, {
        issueType,
        title: title.trim(),
        description: description || undefined,
        priority,
        discipline: discipline || undefined,
        assignedTo: assignedTo || undefined,
        locationId: locationId || undefined,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
      if (isEdit && issue) queryClient.invalidateQueries({ queryKey: ['issue', projectId, issue.id] });
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit issue' : 'New issue'}>
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="title">Title *</label>
          <input id="title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Describe the coordination issue" />
        </div>

        <div>
          <label className="field-label" htmlFor="description">Description</label>
          <textarea id="description" className="field-input min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {!isEdit && (
            <div>
              <label className="field-label" htmlFor="issueType">Type</label>
              <select id="issueType" className="field-input" value={issueType} onChange={(e) => setIssueType(e.target.value as IssueType)}>
                {ISSUE_TYPES.map((t) => (
                  <option key={t} value={t}>{ISSUE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="priority">Priority</label>
            <select id="priority" className="field-input" value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
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
            <label className="field-label" htmlFor="deadline">Deadline</label>
            <input id="deadline" type="date" className="field-input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="discipline">Discipline</label>
            <input id="discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="MEP, Structural…" />
          </div>
          {!isEdit && (
            <div>
              <label className="field-label" htmlFor="locationId">Location</label>
              <select id="locationId" className="field-input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Unassigned</option>
                {allLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create issue'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
