import { AnimatedButton } from '../ui/AnimatedIcon';
import aTrash from 'react-useanimations/lib/trash2';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Input, Textarea } from '../ui/Field';
import { Listbox } from '../ui/Listbox';
import { TimeOfDayField } from '../ui/TimeOfDayField';
import { createMyTask, updateMyTask, deleteMyTask, type UserTask, type UserTaskInput } from '../../lib/workspace.api';
import { listProjects } from '../../lib/projects.api';
import { apiErrorMessage } from '../../lib/api';
import { showToast } from '../../store/toast.store';
import { useInvalidateWorkspace } from '../command-center/hooks';

// Create or edit one of the caller's own tasks or reminders. These are
// private: only their owner ever sees them.
export function TaskFormModal({ open, onClose, task, defaults }: {
  open: boolean;
  onClose: () => void;
  task?: UserTask | null;
  defaults?: Partial<UserTaskInput>;
}) {
  const invalidate = useInvalidateWorkspace();
  const [form, setForm] = useState<UserTaskInput & { title: string }>(() => blank(defaults));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(task ? {
      kind: task.kind, title: task.title, description: task.description ?? '', notes: task.notes ?? '',
      dueDate: task.dueDate ?? '', dueTime: task.dueTime ?? '', priority: task.priority, status: task.status, projectId: task.projectId ?? '',
    } : blank(defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  const projects = useQuery({ queryKey: ['projects', 'picker'], queryFn: () => listProjects({ perPage: 100 }), enabled: open });

  const save = useMutation({
    mutationFn: () => {
      const body: UserTaskInput & { title: string } = {
        ...form,
        title: form.title.trim(),
        description: form.description || null,
        notes: form.notes || null,
        dueDate: form.dueDate || null,
        dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
        projectId: form.projectId || null,
      };
      return task ? updateMyTask(task.id, body) : createMyTask(body);
    },
    onSuccess: () => {
      invalidate();
      showToast(task ? 'Saved' : form.kind === 'reminder' ? 'Reminder added' : 'Task added', 'success');
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteMyTask(task!.id),
    onSuccess: () => { invalidate(); showToast('Deleted', 'success'); onClose(); },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError('Give it a title.');
    if (form.kind === 'reminder' && !form.dueDate) return setError('A reminder needs a date.');
    save.mutate();
  };
  const isReminder = form.kind === 'reminder';

  return (
    <Modal open={open} onClose={onClose} title={task ? (isReminder ? 'Edit reminder' : 'Edit task') : isReminder ? 'New reminder' : 'New personal task'}>
      <form onSubmit={submit} className="space-y-4">
        {!task && (
          <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-2">
            {(['task', 'reminder'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => set('kind', k)}
                className={`h-10 rounded-lg border text-sm font-medium ${form.kind === k ? 'bg-signal text-on-signal border-transparent' : 'border-ink-100/15 text-ink-300 hover:text-ink-100'}`}>
                {k === 'task' ? 'Task' : 'Reminder'}
              </button>
            ))}
          </div>
        )}
        <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={300} autoFocus placeholder={isReminder ? 'e.g. Call the façade supplier' : 'e.g. Review STR-204 Rev.03'} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Due date" requirement={isReminder ? 'required' : 'optional'} type="date" value={form.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value)} />
          <TimeOfDayField label="Time" requirement="optional" value={form.dueTime ?? ''} onChange={(next) => set('dueTime', next)} disabled={!form.dueDate} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="field-label">Priority</span>
            <Listbox value={form.priority} onChange={(e) => set('priority', e.target.value as UserTask['priority'])} aria-label="Priority" className="field-input">
              <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </Listbox>
          </label>
          <label className="block">
            <span className="field-label">Status</span>
            <Listbox value={form.status} onChange={(e) => set('status', e.target.value as UserTask['status'])} aria-label="Status" className="field-input">
              <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option>
            </Listbox>
          </label>
        </div>
        <label className="block">
          <span className="field-label">Project <span className="text-ink-500 font-normal">(optional)</span></span>
          <Listbox value={form.projectId ?? ''} onChange={(e) => set('projectId', e.target.value)} aria-label="Project" className="field-input">
            <option value="">No project</option>
            {(projects.data?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Listbox>
        </label>
        <Textarea label="Description" requirement="optional" rows={3} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        <Textarea label="Notes" requirement="optional" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} hint="Only you can see this." />
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {task && (
            <AnimatedButton animation={aTrash} interaction="hover" type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="btn-ghost text-danger mr-auto">Delete</AnimatedButton>
          )}
          <button type="button" onClick={onClose} className="btn-secondary ml-auto">Cancel</button>
          <button type="submit" disabled={save.isPending} className="btn-primary">{save.isPending ? 'Saving…' : task ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}

function blank(d?: Partial<UserTaskInput>): UserTaskInput & { title: string } {
  return { kind: 'task', title: '', description: '', notes: '', dueDate: '', dueTime: '', priority: 'medium', status: 'todo', projectId: '', ...d } as UserTaskInput & { title: string };
}
