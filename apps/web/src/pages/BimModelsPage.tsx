import { AnimatedButton } from '../components/ui/AnimatedIcon';
import aTrash from 'react-useanimations/lib/trash2';
import { alertDialog } from '../store/confirm.store';
import { confirmDialog } from '../store/confirm.store';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { BimModelUploadModal } from '../components/BimModelUploadModal';
import { listBimModels, reprocessModel, deleteBimModel, bulkDeleteBimModels, type BimModel } from '../lib/bim.api';
import { apiErrorMessage } from '../lib/api';

const STATUS_LABEL: Record<BimModel['status'], string> = {
  pending: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const STATUS_COLOR: Record<BimModel['status'], string> = {
  pending: 'bg-base-800 text-ink-100',
  processing: 'bg-blueprint-muted text-blueprint',
  ready: 'bg-ok/10 text-ok',
  failed: 'bg-danger/10 text-danger',
};

export default function BimModelsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const modelsQuery = useQuery({
    queryKey: ['bim-models', projectId],
    queryFn: () => listBimModels(projectId!),
    enabled: Boolean(projectId),
    // Poll while anything is still pending/processing so progress bars and
    // status badges update without a manual refresh; stops polling once
    // every model has settled into ready/failed.
    refetchInterval: (query) => {
      const models = query.state.data ?? [];
      const anyActive = models.some((m) => m.status === 'pending' || m.status === 'processing');
      return anyActive ? 2000 : false;
    },
  });

  async function handleReprocess(modelId: string) {
    if (!projectId) return;
    try {
      await reprocessModel(projectId, modelId);
      queryClient.invalidateQueries({ queryKey: ['bim-models', projectId] });
    } catch (err) {
      void alertDialog(apiErrorMessage(err), "Couldn't reprocess the model");
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (modelId: string) => deleteBimModel(projectId!, modelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bim-models', projectId] }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteBimModels(projectId!, [...selectedIds]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bim-models', projectId] });
      setSelectedIds(new Set());
    },
  });

  if (!projectId) return null;

  const models = modelsQuery.data ?? [];
  const allSelected = models.length > 0 && selectedIds.size === models.length;

  return (
    <>
      <PageHeader
        eyebrow="BIM"
        title="Models"
        actions={
          <button className="btn-primary" onClick={() => setUploadOpen(true)}>
            Upload IFC model
          </button>
        }
      />

      <div className="p-6">
        {modelsQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

        {!modelsQuery.isLoading && models.length === 0 && (
          <div className="rounded-lg border border-dashed border-base-600 p-10 text-center text-sm text-ink-500">
            No BIM models yet. Upload an IFC file to get started.
          </div>
        )}

        {models.length > 0 && (
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-xs text-ink-500">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelectedIds(allSelected ? new Set() : new Set(models.map((m) => m.id)))}
              />
              Select all
            </label>
            {selectedIds.size > 0 && (
              <>
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <AnimatedButton animation={aTrash} interaction="hover"
                  onClick={async () => { if (await confirmDialog(`Delete ${selectedIds.size} model(s) and every element extracted from them? This cannot be undone.`)) bulkDeleteMutation.mutate(); }}
                  disabled={bulkDeleteMutation.isPending}
                  className="btn-danger !px-4 !py-2 text-sm ml-auto"
                >
                  {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
                </AnimatedButton>
              </>
            )}
            {bulkDeleteMutation.isError && <span className="text-xs text-danger">{apiErrorMessage(bulkDeleteMutation.error)}</span>}
          </div>
        )}

        <ul className="space-y-4">
          {models.map((model) => (
            <li key={model.id} className="flex items-center justify-between rounded-lg border border-base-600 p-4">
              <div className="flex items-center gap-4 flex-1">
                <input
                  type="checkbox"
                  checked={selectedIds.has(model.id)}
                  onChange={() => setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(model.id)) next.delete(model.id); else next.add(model.id);
                    return next;
                  })}
                />
                <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{model.name}</span>
                  <span className={`rounded px-2 py-0 text-xs ${STATUS_COLOR[model.status]}`}>
                    {STATUS_LABEL[model.status]}
                  </span>
                </div>
                {model.status === 'processing' && (
                  <div className="mt-2 w-64">
                    <div className="h-1.5 w-full rounded-full bg-base-700">
                      <div
                        className="h-1.5 rounded-full bg-blueprint"
                        style={{ width: `${model.processingProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-ink-500">
                      {model.processingStage ?? 'Starting…'} · {model.processingProgress}%
                    </p>
                  </div>
                )}
                {model.status === 'failed' && (
                  <p className="mt-2 text-xs text-danger">{model.processingError}</p>
                )}
                {model.status === 'ready' && (
                  <p className="mt-2 text-xs text-ink-500">{model.elementCount} elements</p>
                )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {model.status === 'ready' && (
                  <Link to={`/projects/${projectId}/bim/${model.id}`} className="btn-secondary">
                    Open viewer
                  </Link>
                )}
                {model.status === 'failed' && (
                  <button className="btn-secondary" onClick={() => handleReprocess(model.id)}>
                    Retry
                  </button>
                )}
                <AnimatedButton animation={aTrash} interaction="hover"
                  onClick={async () => { if (await confirmDialog(`Delete "${model.name}" and every element extracted from it? This cannot be undone.`)) deleteMutation.mutate(model.id); }}
                  disabled={deleteMutation.isPending}
                  className="btn-secondary !text-danger"
                >
                  Delete
                </AnimatedButton>
              </div>
            </li>
          ))}
        </ul>
        {deleteMutation.isError && <p className="field-error mt-2">{apiErrorMessage(deleteMutation.error)}</p>}
      </div>

      <BimModelUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} />
    </>
  );
}
