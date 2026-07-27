import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { HierarchyTree } from '../components/HierarchyTree';
import { AddHierarchyNodeModal } from '../components/AddHierarchyNodeModal';
import { CaptureGrid } from '../components/CaptureGrid';
import { CaptureUploadModal } from '../components/CaptureUploadModal';
import { getProject, getHierarchy } from '../lib/projects.api';
import { listCaptures } from '../lib/captures.api';

type NodeModalState = { kind: 'building' } | { kind: 'level'; buildingId: string } | { kind: 'location'; buildingId: string; levelId: string } | null;

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedLocation, setSelectedLocation] = useState<{ id: string; name: string } | null>(null);
  const [nodeModal, setNodeModal] = useState<NodeModalState>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const capturesQuery = useQuery({
    queryKey: ['captures', projectId, selectedLocation?.id],
    queryFn: () => listCaptures(projectId!, { locationId: selectedLocation?.id, perPage: 24 }),
    enabled: Boolean(projectId),
  });

  const allLocations = (hierarchyQuery.data ?? []).flatMap((b) =>
    (b.levels ?? []).flatMap((l) => l.locations ?? []),
  );

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.code ?? 'Project'}
        title={projectQuery.data?.name ?? 'Loading…'}
        actions={
          <>
            <Link to={`/projects/${projectId}/drawings`} className="btn-secondary">Floor plans</Link>
            <Link to={`/projects/${projectId}/bim`} className="btn-secondary">BIM models</Link>
            <button onClick={() => setUploadOpen(true)} className="btn-primary">
              <UploadIcon /> Upload captures
            </button>
          </>
        }
      />

      <div className="p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="tick-frame panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-mono uppercase tracking-widest text-ink-500">Hierarchy</h3>
              <button
                onClick={() => setNodeModal({ kind: 'building' })}
                className="text-ink-500 hover:text-blueprint"
                title="Add building"
              >
                <PlusIcon />
              </button>
            </div>
            {hierarchyQuery.isLoading && <div className="text-sm text-ink-500 py-4">Loading…</div>}
            {hierarchyQuery.data && (
              <HierarchyTree
                buildings={hierarchyQuery.data}
                selectedLocationId={selectedLocation?.id}
                onSelectLocation={(id, name) => setSelectedLocation({ id, name })}
                onAddLevel={(buildingId) => setNodeModal({ kind: 'level', buildingId })}
                onAddLocation={(buildingId, levelId) => setNodeModal({ kind: 'location', buildingId, levelId })}
              />
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {selectedLocation ? `Captures — ${selectedLocation.name}` : 'All captures'}
            </h2>
            {selectedLocation && (
              <div className="flex items-center gap-3">
                <Link to={`/projects/${projectId}/viewer/${selectedLocation.id}`} className="text-xs text-blueprint hover:text-blueprint-hover">
                  Open 360° viewer →
                </Link>
                <button onClick={() => setSelectedLocation(null)} className="text-xs text-ink-500 hover:text-ink-100">
                  Clear filter
                </button>
              </div>
            )}
          </div>

          {capturesQuery.isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-video panel animate-pulse bg-base-700/40" />
              ))}
            </div>
          )}
          {capturesQuery.data && <CaptureGrid projectId={projectId} captures={capturesQuery.data.data} />}
        </div>
      </div>

      {nodeModal && (
        <AddHierarchyNodeModal
          open
          onClose={() => setNodeModal(null)}
          kind={nodeModal.kind}
          projectId={projectId}
          buildingId={'buildingId' in nodeModal ? nodeModal.buildingId : undefined}
          levelId={'levelId' in nodeModal ? nodeModal.levelId : undefined}
        />
      )}

      <CaptureUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        locations={allLocations}
        defaultLocationId={selectedLocation?.id}
      />
    </>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4M7 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
