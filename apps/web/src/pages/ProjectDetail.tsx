import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectPhase } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { HierarchyTree } from '../components/HierarchyTree';
import { AddHierarchyNodeModal } from '../components/AddHierarchyNodeModal';
import { CaptureGrid } from '../components/CaptureGrid';
import { CaptureUploadModal } from '../components/CaptureUploadModal';
import { EditProjectModal } from '../components/EditProjectModal';
import { getProject, getHierarchy, updateBuilding } from '../lib/projects.api';
import { listCaptures } from '../lib/captures.api';

type NodeModalState = { kind: 'building' } | { kind: 'level'; buildingId: string } | { kind: 'location'; buildingId: string; levelId: string } | null;

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [selectedLocation, setSelectedLocation] = useState<{ id: string; name: string } | null>(null);
  const [nodeModal, setNodeModal] = useState<NodeModalState>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const buildingPhaseMutation = useMutation({
    mutationFn: ({ buildingId, phase }: { buildingId: string; phase: ProjectPhase | '' }) =>
      updateBuilding(projectId!, buildingId, { phase: phase || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hierarchy', projectId] }),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const capturesQuery = useQuery({
    queryKey: ['captures', projectId, selectedLocation?.id],
    queryFn: () => listCaptures(projectId!, { locationId: selectedLocation?.id, perPage: 24 }),
    // Only fetch once something is actually selected -- there is no
    // "browse everything" view here by design; an unfiltered fetch would
    // just be every capture in the project dumped on screen at once.
    enabled: Boolean(projectId) && Boolean(selectedLocation),
  });

  const allLocations = (hierarchyQuery.data ?? []).flatMap((b) =>
    (b.levels ?? []).flatMap((l) => l.locations ?? []),
  );

  // The tree only passes id/name on click -- the note itself lives on the
  // full location record already loaded as part of the hierarchy.
  const selectedLocationDetail = selectedLocation
    ? allLocations.find((l) => l.id === selectedLocation.id)
    : undefined;

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.code ?? 'Project'}
        title={projectQuery.data?.name ?? 'Loading…'}
        actions={
          <>
            <button onClick={() => setEditOpen(true)} className="btn-secondary">
              <EditIcon /> Edit
            </button>
            <Link to={`/projects/${projectId}/drawings`} className="btn-secondary">Floor plans</Link>
            <Link to={`/projects/${projectId}/bim`} className="btn-secondary">BIM models</Link>
            <button onClick={() => setUploadOpen(true)} className="btn-primary">
              <UploadIcon /> Upload captures
            </button>
          </>
        }
      />

      {projectQuery.data?.phase && (
        <div className="px-6 pt-4 flex items-center gap-2 text-xs text-ink-500">
          <span className="font-mono uppercase tracking-widest">Phase</span>
          <span className="text-ink-300">{projectQuery.data.phase.replace(/_/g, ' ')}</span>
        </div>
      )}

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
                onSetBuildingPhase={(buildingId, phase) => buildingPhaseMutation.mutate({ buildingId, phase })}
                buildingPhaseSaving={buildingPhaseMutation.isPending}
              />
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          {selectedLocation ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Captures — {selectedLocation.name}</h2>
                <div className="flex items-center gap-3">
                  <Link to={`/projects/${projectId}/viewer/${selectedLocation.id}`} className="text-xs text-blueprint hover:text-blueprint-hover">
                    Open 360° viewer →
                  </Link>
                  <button onClick={() => setSelectedLocation(null)} className="text-xs text-ink-500 hover:text-ink-100">
                    Clear filter
                  </button>
                </div>
              </div>

              {selectedLocationDetail?.description && (
                <div className="panel p-3 text-sm text-ink-100">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500 mb-1">Note</div>
                  {selectedLocationDetail.description}
                </div>
              )}

              {capturesQuery.isLoading && (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-video panel animate-pulse bg-base-700/40" />
                  ))}
                </div>
              )}
              {capturesQuery.data && <CaptureGrid projectId={projectId} captures={capturesQuery.data.data} />}
            </>
          ) : (
            <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
              Select a location on the left to see what's there.
            </div>
          )}
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

      <EditProjectModal open={editOpen} onClose={() => setEditOpen(false)} project={projectQuery.data} />
    </>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
