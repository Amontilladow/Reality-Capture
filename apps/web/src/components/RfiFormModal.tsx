import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RfiPriority, RfiDiscipline, RfiImpactLevel } from '@engineeringos/types';
import { RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, RFI_IMPACT_LEVELS, RFI_IMPACT_LEVEL_LABELS } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { RichTextEditor, isRichTextEmpty } from './ui/RichTextEditor';
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
  const [discipline, setDiscipline] = useState<RfiDiscipline | ''>('');
  const [disciplineOther, setDisciplineOther] = useState('');

  // 4-state cost/time impact (Phase 1 backend shape) -- replaces the plain
  // checkboxes. 'yes'/'potential'/'tbd' all reveal the detail fields per the
  // original spec's field rules; only 'no' hides them.
  const [costImpactLevel, setCostImpactLevel] = useState<RfiImpactLevel>('no');
  const [costImpactAmount, setCostImpactAmount] = useState('');
  const [costImpactCurrency, setCostImpactCurrency] = useState('');
  const [costImpactDescription, setCostImpactDescription] = useState('');

  const [timeImpactLevel, setTimeImpactLevel] = useState<RfiImpactLevel>('no');
  const [timeImpactDays, setTimeImpactDays] = useState('');
  const [timeImpactDescription, setTimeImpactDescription] = useState('');

  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setSubject(''); setQuestion(''); setPriority('medium');
    setDiscipline(''); setDisciplineOther('');
    setCostImpactLevel('no'); setCostImpactAmount(''); setCostImpactCurrency(''); setCostImpactDescription('');
    setTimeImpactLevel('no'); setTimeImpactDays(''); setTimeImpactDescription('');
    setAssignedTo(''); setDueDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!subject.trim()) throw new Error('Subject is required.');
      if (isRichTextEmpty(question)) throw new Error('Question is required.');
      if (!discipline) throw new Error('Discipline is required.');
      if (discipline === 'other' && !disciplineOther.trim()) throw new Error('Please specify the discipline.');
      return createRfi(projectId, {
        subject: subject.trim(),
        question,
        priority,
        discipline,
        disciplineOther: discipline === 'other' ? disciplineOther.trim() : undefined,
        costImpactLevel,
        costImpactAmount: costImpactLevel !== 'no' && costImpactAmount ? Number(costImpactAmount) : undefined,
        costImpactCurrency: costImpactLevel !== 'no' ? costImpactCurrency.trim() || undefined : undefined,
        costImpactDescription: costImpactLevel !== 'no' ? costImpactDescription.trim() || undefined : undefined,
        timeImpactLevel,
        timeImpactDays: timeImpactLevel !== 'no' && timeImpactDays ? Number(timeImpactDays) : undefined,
        timeImpactDescription: timeImpactLevel !== 'no' ? timeImpactDescription.trim() || undefined : undefined,
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
          <div className="field-label">Question *</div>
          <RichTextEditor value={question} onChange={setQuestion} placeholder="Describe the question that needs a formal answer…" />
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
            <label className="field-label" htmlFor="discipline">Discipline *</label>
            <select id="discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value as RfiDiscipline)}>
              <option value="">Select…</option>
              {RFI_DISCIPLINES.map((d) => (
                <option key={d} value={d}>{RFI_DISCIPLINE_LABELS[d]}</option>
              ))}
            </select>
          </div>
        </div>

        {discipline === 'other' && (
          <div>
            <label className="field-label" htmlFor="disciplineOther">Please specify *</label>
            <input id="disciplineOther" className="field-input" value={disciplineOther} onChange={(e) => setDisciplineOther(e.target.value)} />
          </div>
        )}

        {/* Cost impact -- 4-state, revealing amount/currency/description
            whenever the level isn't 'no' (Yes/Potential/TBD all reveal, per
            the original spec's field rules). */}
        <div className="pt-2 border-t border-base-600 space-y-2">
          <label className="field-label" htmlFor="costImpactLevel">Cost impact</label>
          <select
            id="costImpactLevel"
            className="field-input"
            value={costImpactLevel}
            onChange={(e) => setCostImpactLevel(e.target.value as RfiImpactLevel)}
          >
            {RFI_IMPACT_LEVELS.map((l) => (
              <option key={l} value={l}>{RFI_IMPACT_LEVEL_LABELS[l]}</option>
            ))}
          </select>
          {costImpactLevel !== 'no' && (
            <div className="grid grid-cols-2 gap-3">
              <input
                className="field-input"
                type="number"
                placeholder="Amount"
                value={costImpactAmount}
                onChange={(e) => setCostImpactAmount(e.target.value)}
              />
              <input
                className="field-input"
                placeholder="Currency (e.g. USD)"
                value={costImpactCurrency}
                onChange={(e) => setCostImpactCurrency(e.target.value)}
              />
              <textarea
                className="field-input col-span-2 min-h-[64px]"
                placeholder="Cost impact description…"
                value={costImpactDescription}
                onChange={(e) => setCostImpactDescription(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Time impact -- same 4-state shape, days + description instead of
            amount/currency. */}
        <div className="space-y-2">
          <label className="field-label" htmlFor="timeImpactLevel">Time impact</label>
          <select
            id="timeImpactLevel"
            className="field-input"
            value={timeImpactLevel}
            onChange={(e) => setTimeImpactLevel(e.target.value as RfiImpactLevel)}
          >
            {RFI_IMPACT_LEVELS.map((l) => (
              <option key={l} value={l}>{RFI_IMPACT_LEVEL_LABELS[l]}</option>
            ))}
          </select>
          {timeImpactLevel !== 'no' && (
            <div className="grid grid-cols-2 gap-3">
              <input
                className="field-input"
                type="number"
                placeholder="Days"
                value={timeImpactDays}
                onChange={(e) => setTimeImpactDays(e.target.value)}
              />
              <textarea
                className="field-input min-h-[64px]"
                placeholder="Time impact description…"
                value={timeImpactDescription}
                onChange={(e) => setTimeImpactDescription(e.target.value)}
              />
            </div>
          )}
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
