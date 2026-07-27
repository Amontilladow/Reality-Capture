import { useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BimViewer, type BimViewerHandle } from '../components/bim-viewer/BimViewer';
import { SpatialTree } from '../components/bim-viewer/SpatialTree';
import { PropertyPanel } from '../components/bim-viewer/PropertyPanel';
import { ElementSearch } from '../components/bim-viewer/ElementSearch';
import { getModelViewerData, getModelHierarchy, getElementByGuid, listBimModels, type BimElementDetail } from '../lib/bim.api';

export default function BimViewerPage() {
  const { projectId, modelId } = useParams<{ projectId: string; modelId: string }>();
  const viewerRef = useRef<BimViewerHandle>(null);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const modelsQuery = useQuery({
    queryKey: ['bim-models', projectId],
    queryFn: () => listBimModels(projectId!),
    enabled: Boolean(projectId),
  });
  const modelName = modelsQuery.data?.find((m) => m.id === modelId)?.name;

  const viewerDataQuery = useQuery({
    queryKey: ['bim-viewer-data', projectId, modelId],
    queryFn: () => getModelViewerData(projectId!, modelId!),
    enabled: Boolean(projectId && modelId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['bim-hierarchy', projectId, modelId],
    queryFn: () => getModelHierarchy(projectId!, modelId!),
    enabled: Boolean(projectId && modelId),
  });

  const elementQuery = useQuery({
    queryKey: ['bim-element-by-guid', projectId, modelId, selectedGuid],
    queryFn: () => getElementByGuid(projectId!, modelId!, selectedGuid!),
    enabled: Boolean(projectId && modelId && selectedGuid),
  });

  function handleSelectFromViewer(guid: string | null) {
    setSelectedGuid(guid);
    setSelectedNodeId(null);
  }

  function handleSelectFromTree(node: { id: string; ifcGuid: string; name: string | null }) {
    setSelectedNodeId(node.id);
    setSelectedGuid(node.ifcGuid);
  }

  function handleSelectFromSearch(element: BimElementDetail) {
    setSelectedNodeId(null);
    setSelectedGuid(element.ifcGuid);
    viewerRef.current?.selectByGuid(element.ifcGuid);
  }

  if (!projectId || !modelId) return null;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to={`/projects/${projectId}/bim`} className="text-sm text-gray-500 hover:text-gray-800">
            ← Models
          </Link>
          <span className="font-medium">{modelName ?? 'Model'}</span>
        </div>
        {viewerDataQuery.data?.status === 'ready' && viewerDataQuery.data.fragmentsUrl && (
          <div className="flex items-center gap-3">
            <ElementSearch projectId={projectId} modelId={modelId} onSelect={handleSelectFromSearch} />
            <button className="btn-secondary" onClick={() => viewerRef.current?.fitToModel()}>
              Fit to model
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
          {hierarchyQuery.isLoading && <p className="p-3 text-sm text-gray-400">Loading hierarchy…</p>}
          {hierarchyQuery.data && (
            <SpatialTree
              nodes={hierarchyQuery.data}
              selectedId={selectedNodeId}
              onSelect={handleSelectFromTree}
            />
          )}
        </aside>

        <main className="relative flex-1 bg-gray-50">
          {viewerDataQuery.isLoading && (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading…</div>
          )}
          {viewerDataQuery.data && viewerDataQuery.data.status !== 'ready' && (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              Model is still {viewerDataQuery.data.status}. Come back once processing finishes.
            </div>
          )}
          {viewerDataQuery.data?.status === 'ready' && !viewerDataQuery.data.fragmentsUrl && (
            <div className="flex h-full items-center justify-center text-sm text-red-600">
              {viewerDataQuery.data.processingError ?? 'No viewer geometry is available for this model.'}
            </div>
          )}
          {viewerDataQuery.data?.status === 'ready' && viewerDataQuery.data.fragmentsUrl && (
            <BimViewer
              ref={viewerRef}
              fragmentsUrl={viewerDataQuery.data.fragmentsUrl}
              onSelect={handleSelectFromViewer}
            />
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
          <PropertyPanel element={elementQuery.data ?? null} loading={elementQuery.isFetching} />
        </aside>
      </div>
    </div>
  );
}
