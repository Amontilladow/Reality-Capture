import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueType, IssuePriority, IssueDiscipline, IssueCategory } from '@engineeringos/types';
import { Modal } from '../ui/Modal';
import { createIssue, updateIssue, type IssueDetailItem } from '../../lib/issues.api';
import type { CameraVector } from '../bim-viewer/BimViewer';
import type { ProjectMember } from '../../lib/projects.api';
import type { ProjectHierarchy } from '../../lib/projects.api';
import { BuildingLevelRoomPicker, type HierarchySelection } from '../hierarchy/BuildingLevelRoomPicker';
import {
  ISSUE_TYPES, ISSUE_TYPE_LABELS, ISSUE_PRIORITIES, PRIORITY_LABELS,
  ISSUE_DISCIPLINES, DISCIPLINE_LABELS, ISSUE_CATEGORIES, CATEGORY_LABELS,
} from '../../lib/issue-constants';
import { apiErrorMessage } from '../../lib/api';

export function IssueFormModal({
  open,
  onClose,
  projectId,
  members,
  hierarchy,
  issue,
  defaultElementId,
  defaultElementName,
  viewState,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
  hierarchy: ProjectHierarchy[];
  issue?: IssueDetailItem;
  defaultElementId?: string;
  defaultElementName?: string;
  // Captured automatically from the BIM viewer when "Raise issue" is
  // clicked there -- not user-editable, so no corresponding form field.
  viewState?: {
    modelId: string;
    cameraPosition: CameraVector;
    cameraTarget: CameraVector;
    screenshotStorageKey?: string | null;
  };
}) {
  const isEdit = Boolean(issue);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState<IssueType>('defect');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [discipline, setDiscipline] = useState<IssueDiscipline | ''>('');
  const [category, setCategory] = useState<IssueCategory | ''>('');
  const [assignedTo, setAssignedTo] = useState('');
  const [place, setPlace] = useState<HierarchySelection>({ buildingId: '', levelId: '', locationId: '' });
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(issue?.title ?? '');
    setDescription(issue?.description ?? '');
    setIssueType(issue?.issueType ?? 'defect');
    setPriority(issue?.priority ?? 'medium');
    setDiscipline(issue?.discipline ?? '');
    setCategory(issue?.category ?? '');
    setAssignedTo(issue?.assignedTo ?? '');
    setPlace({
      buildingId: issue?.buildingId ?? '',
      levelId: issue?.levelId ?? '',
      locationId: issue?.locationId ?? '',
    });
    setDeadline(issue?.deadline ? issue.deadline.slice(0, 10) : '');
    setError('');
  }, [open, issue]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required.');
      if (!discipline) throw new Error('Discipline is required.');
      if (!deadline) throw new Error('Deadline is required.');
      const deadlineIso = new Date(deadline).toISOString();
      if (isEdit && issue) {
        return updateIssue(projectId, issue.id, {
          title: title.trim(),
          description: description || undefined,
          priority,
          discipline,
          category: category || undefined,
          buildingId: place.buildingId || undefined,
          levelId: place.levelId || undefined,
          locationId: place.locationId || undefined,
          assignedTo: assignedTo || undefined,
          deadline: deadlineIso,
        });
      }
      return createIssue(projectId, {
        issueType,
        title: title.trim(),
        description: description || undefined,
        priority,
        discipline,
        category: category || undefined,
        buildingId: place.buildingId || undefined,
        levelId: place.levelId || undefined,
        locationId: place.locationId || undefined,
        assignedTo: assignedTo || undefined,
        elementId: defaultElementId,
        deadline: deadlineIso,
        modelId: viewState?.modelId,
        cameraPosX: viewState?.cameraPosition.x,
        cameraPosY: viewState?.cameraPosition.y,
        cameraPosZ: viewState?.cameraPosition.z,
        cameraTargetX: viewState?.cameraTarget.x,
        cameraTargetY: viewState?.cameraTarget.y,
        cameraTargetZ: viewState?.cameraTarget.z,
        screenshotStorageKey: viewState?.screenshotStorageKey ?? undefined,
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
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit issue' : 'New issue'} wide>
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        {!isEdit && defaultElementId && (
          <div className="text-xs text-ink-500 bg-base-700/40 rounded px-3 py-2">
            BIM element: <span className="text-ink-100">{defaultElementName || defaultElementId}</span>
          </div>
        )}

        {!isEdit && viewState && (
          <div className="text-xs text-ink-500 bg-base-700/40 rounded px-3 py-2">
            3D view captured{viewState.screenshotStorageKey ? ' with screenshot' : ''} — "view in 3D" will reopen this exact vantage point.
          </div>
        )}

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
            <label className="field-label" htmlFor="deadline">Deadline *</label>
            <input id="deadline" type="date" required className="field-input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="discipline">Discipline *</label>
            <select
              id="discipline"
              className="field-input"
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value as IssueDiscipline)}
            >
              <option value="" disabled>Select discipline…</option>
              {ISSUE_DISCIPLINES.map((d) => (
                <option key={d} value={d}>{DISCIPLINE_LABELS[d]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="category">Category</label>
            <select
              id="category"
              className="field-input"
              value={category}
              onChange={(e) => setCategory(e.target.value as IssueCategory)}
            >
              <option value="">None</option>
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label">Location</label>
          <BuildingLevelRoomPicker projectId={projectId} hierarchy={hierarchy} value={place} onChange={setPlace} />
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
