import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { createBuilding, createLevel, createLocation } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

type Kind = 'building' | 'level' | 'location';

interface Props {
  open: boolean;
  onClose: () => void;
  kind: Kind;
  projectId: string;
  buildingId?: string; // required for level
  levelId?: string; // required for location
}

const TITLES: Record<Kind, string> = {
  building: 'Add building',
  level: 'Add level',
  location: 'Add location',
};

interface FormValues {
  name: string;
  code?: string;
  elevationM?: number;
  levelOrder?: number;
  description?: string;
}

export function AddHierarchyNodeModal({ open, onClose, kind, projectId, buildingId, levelId }: Props) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>();

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (kind === 'building') return createBuilding(projectId, { name: values.name, code: values.code });
      if (kind === 'level' && buildingId)
        return createLevel(projectId, buildingId, {
          name: values.name,
          elevationM: values.elevationM ? Number(values.elevationM) : undefined,
          levelOrder: values.levelOrder ? Number(values.levelOrder) : 0,
        });
      if (kind === 'location' && buildingId && levelId)
        return createLocation(projectId, buildingId, levelId, { name: values.name, description: values.description });
      throw new Error('Missing parent for this node.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hierarchy', projectId] });
      reset();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={TITLES[kind]}>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="name">Name</label>
          <input
            id="name"
            className="field-input"
            placeholder={kind === 'building' ? 'Tower B' : kind === 'level' ? 'Level 10' : 'Northeast corner'}
            {...register('name', { required: 'Name is required' })}
          />
          {errors.name && <p className="field-error">{errors.name.message}</p>}
        </div>

        {kind === 'building' && (
          <div>
            <label className="field-label" htmlFor="code">Code</label>
            <input id="code" className="field-input font-mono" placeholder="TWR-B" {...register('code')} />
          </div>
        )}

        {kind === 'level' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="levelOrder">Order</label>
              <input id="levelOrder" type="number" className="field-input" placeholder="10" {...register('levelOrder')} />
            </div>
            <div>
              <label className="field-label" htmlFor="elevationM">Elevation (m)</label>
              <input id="elevationM" type="number" step="0.01" className="field-input" placeholder="34.5" {...register('elevationM')} />
            </div>
          </div>
        )}

        {kind === 'location' && (
          <div>
            <label className="field-label" htmlFor="description">Description</label>
            <textarea id="description" className="field-input min-h-16 resize-none" {...register('description')} />
          </div>
        )}

        {mutation.isError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {apiErrorMessage(mutation.error)}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
