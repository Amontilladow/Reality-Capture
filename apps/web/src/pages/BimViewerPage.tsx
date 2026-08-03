import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BimViewer, type BimViewerHandle } from '../components/bim-viewer/BimViewer';
import { SpatialTree } from '../components/bim-viewer/SpatialTree';
import { ElementList } from '../components/bim-viewer/ElementList';
import { PropertyPanel } from '../components/bim-viewer/PropertyPanel';
import { ElementSearch } from '../components/bim-viewer/ElementSearch';
import { IssueFormModal } from '../components/issues/IssueFormModal';
import { getModelViewerData, getModelHierarchy, getElementByGuid, listBimModels, type BimElementDetail } from '../lib/bim.api';
import { getMembers, getHierarchy } from '../lib/projects.api';
import { uploadIssueScreenshot } from '../lib/issues.api';
import type { CameraVector } from '../components/bim-viewer/BimViewer';

export default function BimViewerPage() {
  const { projectId, modelId } = useParams<{ projectId: string; modelId: string }>();
  const [searchParams] = useSearchParams();
  const jumpToGuid = searchParams.get('guid');
  const viewerRef = useRef<BimViewerHandle>(null);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [raiseIssueOpen, setRaiseIssueOpen] = useState(false);
  const [jumpApplied, setJumpApplied] = useState(false);
  const [cameraJumpApplied, setCameraJumpApplied] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'tree' | 'list'>('tree');
  const [capturedView, setCapturedView] = useState<{
    modelId: string;
    cameraPosition: CameraVector;
    cameraTarget: CameraVector;
    screenshotStorageKey: string | null;
  } | null>(null);

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

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId) && raiseIssueOpen,
  });

  const projectHierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId) && raiseIssueOpen,
  });

  // Jump straight to an element when arriving from a pin or issue's "View in
  // 3D" link. Retried with a short delay because the fragments model can
  // still be loading in BimViewer when this effect first fires.
  useEffect(() => {
    if (jumpApplied || !jumpToGuid) return;
    if (viewerDataQuery.data?.status !== 'ready' || !viewerDataQuery.data.fragmentsUrl) return;

    let cancelled = false;
    let attempts = 0;
    const tryApply = async () => {
      if (cancelled) return;
      const ok = await viewerRef.current?.selectByGuid(jumpToGuid);
      if (ok) {
        setSelectedGuid(jumpToGuid);
        setSelectedNodeId(null);
        setJumpApplied(true);
        return;
      }
      attempts += 1;
      if (attempts < 15) setTimeout(tryApply, 300);
    };
    tryApply();
    return () => {
      cancelled = true;
    };
  }, [jumpToGuid, jumpApplied, viewerDataQuery.data]);

  // Restore the exact camera view an issue was raised from, if the link
  // that brought us here encoded one (see IssueDetail's "view in 3D" link).
  // Gated on modelReady (fired by BimViewer after its own initial
  // fit-to-model has already run) rather than a guessed delay, so this
  // reliably applies last instead of racing the load sequence's own
  // positioning.
  useEffect(() => {
    if (cameraJumpApplied || !modelReady) return;
    const cx = searchParams.get('cx');
    const cy = searchParams.get('cy');
    const cz = searchParams.get('cz');
    const tx = searchParams.get('tx');
    const ty = searchParams.get('ty');
    const tz = searchParams.get('tz');
    if ([cx, cy, cz, tx, ty, tz].some((v) => v === null)) return;

    viewerRef.current?.setCameraState({
      position: { x: Number(cx), y: Number(cy), z: Number(cz) },
      target: { x: Number(tx), y: Number(ty), z: Number(tz) },
    });
    setCameraJumpApplied(true);
  }, [searchParams, cameraJumpApplied, modelReady]);

  async function handleRaiseIssue() {
    const cameraState = viewerRef.current?.getCameraState();
    if (!cameraState || !modelId) {
      setCapturedView(null);
      setRaiseIssueOpen(true);
      return;
    }
    const screenshotDataUrl = viewerRef.current?.getScreenshotDataUrl() ?? null;
    // Open immediately with position/target -- don't make the user wait on
    // the screenshot upload before they can start filling out the form.
    // The upload result attaches itself once it resolves.
    setCapturedView({
      modelId,
      cameraPosition: cameraState.position,
      cameraTarget: cameraState.target,
      screenshotStorageKey: null,
    });
    setRaiseIssueOpen(true);
    if (screenshotDataUrl && projectId) {
      const storageKey = await uploadIssueScreenshot(projectId, screenshotDataUrl);
      setCapturedView((prev) => (prev ? { ...prev, screenshotStorageKey: storageKey } : prev));
    }
  }

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
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 text-gray-900">
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
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white text-gray-900">
          <div className="flex shrink-0 border-b border-gray-200 text-xs font-medium">
            <button
              type="button"
              onClick={() => setSidebarTab('tree')}
              className={`flex-1 px-3 py-2 ${sidebarTab === 'tree' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-800'}`}
            >
              Spatial tree
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('list')}
              className={`flex-1 px-3 py-2 ${sidebarTab === 'list' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-800'}`}
            >
              All elements
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {sidebarTab === 'tree' ? (
              <div className="h-full overflow-y-auto">
                {hierarchyQuery.isLoading && <p className="p-3 text-sm text-gray-400">Loading hierarchy…</p>}
                {hierarchyQuery.data && (
                  <SpatialTree
                    nodes={hierarchyQuery.data}
                    selectedId={selectedNodeId}
                    onSelect={handleSelectFromTree}
                  />
                )}
              </div>
            ) : (
              <ElementList
                projectId={projectId}
                modelId={modelId}
                selectedGuid={selectedGuid}
                onSelect={handleSelectFromSearch}
              />
            )}
          </div>
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
              onModelReady={() => setModelReady(true)}
            />
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white text-gray-900">
          <PropertyPanel
            element={elementQuery.data ?? null}
            loading={elementQuery.isFetching}
            projectId={projectId}
            onRaiseIssue={handleRaiseIssue}
          />
        </aside>
      </div>

      {elementQuery.data && (
        <IssueFormModal
          open={raiseIssueOpen}
          onClose={() => { setRaiseIssueOpen(false); setCapturedView(null); }}
          projectId={projectId}
          members={membersQuery.data ?? []}
          hierarchy={projectHierarchyQuery.data ?? []}
          defaultElementId={elementQuery.data.id}
          defaultElementName={elementQuery.data.ifcName ?? elementQuery.data.ifcType.replace('IFC', '')}
          viewState={capturedView ?? undefined}
        />
      )}
    </div>
  );
}
