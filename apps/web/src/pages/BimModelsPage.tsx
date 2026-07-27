import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { BimModelUploadModal } from '../components/BimModelUploadModal';
import { listBimModels, reprocessModel, type BimModel } from '../lib/bim.api';
import { apiErrorMessage } from '../lib/api';

const STATUS_LABEL: Record<BimModel['status'], string> = {
  pending: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const STATUS_COLOR: Record<BimModel['status'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  processing: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function BimModelsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);

  const modelsQuery = useQuery({
    queryKey: ['bim-models', projectId],
    queryFn: () => listBimModels(projectId!),
    enabled: Boolean(projectId),
    // Poll while anything is still pending/processing so progress bars and
    // status badges update without a manual refresh — stops polling once
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
      alert(apiErrorMessage(err));
    }
  }

  if (!projectId) return null;

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
        {modelsQuery.isLoading && <p className="text-sm text-gray-500">Loading…</p>}

        {!modelsQuery.isLoading && (modelsQuery.data ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
            No BIM models yet. Upload an IFC file to get started.
          </div>
        )}

        <ul className="space-y-3">
          {(modelsQuery.data ?? []).map((model) => (
            <li key={model.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{model.name}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[model.status]}`}>
                    {STATUS_LABEL[model.status]}
                  </span>
                </div>
                {model.status === 'processing' && (
                  <div className="mt-2 w-64">
                    <div className="h-1.5 w-full rounded-full bg-gray-200">
                      <div
                        className="h-1.5 rounded-full bg-blue-600 transition-all"
                        style={{ width: `${model.processingProgress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {model.processingStage ?? 'Starting…'} · {model.processingProgress}%
                    </p>
                  </div>
                )}
                {model.status === 'failed' && (
                  <p className="mt-1 text-xs text-red-600">{model.processingError}</p>
                )}
                {model.status === 'ready' && (
                  <p className="mt-1 text-xs text-gray-500">{model.elementCount} elements</p>
                )}
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
              </div>
            </li>
          ))}
        </ul>
      </div>

      <BimModelUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} />
    </>
  );
}
