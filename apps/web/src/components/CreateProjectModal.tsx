import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { createProject, type CreateProjectPayload } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

export function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProjectPayload>();

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      reset();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        className="space-y-4"
      >
        <div>
          <label className="field-label" htmlFor="name">Project name</label>
          <input
            id="name"
            className="field-input"
            placeholder="Marina Heights Tower B"
            {...register('name', { required: 'Project name is required' })}
          />
          {errors.name && <p className="field-error">{errors.name.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="code">Project code</label>
            <input id="code" className="field-input font-mono" placeholder="MHT-B" {...register('code')} />
          </div>
          <div>
            <label className="field-label" htmlFor="city">City</label>
            <input id="city" className="field-input" placeholder="Abu Dhabi" {...register('city')} />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="description">Description</label>
          <textarea id="description" className="field-input min-h-20 resize-none" {...register('description')} />
        </div>

        {mutation.isError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {apiErrorMessage(mutation.error)}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
