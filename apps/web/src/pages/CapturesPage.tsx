import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { CaptureGrid } from '../components/CaptureGrid';
import { CaptureUploadModal } from '../components/CaptureUploadModal';
import { listCaptures } from '../lib/captures.api';
import { getHierarchy, getProject } from '../lib/projects.api';
import { PROJECT_PHASES, PROJECT_PHASE_LABELS } from '@engineeringos/types';

const CAPTURE_TYPES = [
  { value: '', label: 'All types' },
  { value: 'photo_360', label: '360° photo' },
  { value: 'photo_standard', label: 'Standard photo' },
  { value: 'video', label: 'Video' },
];

export default function CapturesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [captureType, setCaptureType] = useState('');
  const [phase, setPhase] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [locationId, setLocationId] = useState('');
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
    queryKey: ['captures', projectId, 'all', captureType, phase, buildingId, levelId, locationId],
    queryFn: () =>
      listCaptures(projectId!, {
        perPage: 60,
        captureType: captureType || undefined,
        phase: phase || undefined,
        buildingId: buildingId || undefined,
        levelId: levelId || undefined,
        locationId: locationId || undefined,
      }),
    enabled: Boolean(projectId),
  });

  const allLocations = (hierarchyQuery.data ?? []).flatMap((b) =>
    (b.levels ?? []).flatMap((l) => l.locations ?? []),
  );

  const selectedBuilding = hierarchyQuery.data?.find((b) => b.id === buildingId);
  const levelOptions = selectedBuilding?.levels ?? [];
  const selectedLevel = levelOptions.find((l) => l.id === levelId);
  const locationOptions = selectedLevel?.locations ?? [];

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Captures"
        actions={
          <button onClick={() => setUploadOpen(true)} className="btn-primary">
            <UploadIcon /> Upload
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select className="field-input w-auto" value={captureType} onChange={(e) => setCaptureType(e.target.value)}>
            {CAPTURE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select className="field-input w-auto" value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="">All phases</option>
            {PROJECT_PHASES.map((p) => (
              <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
            ))}
          </select>

          <select
            className="field-input w-auto"
            value={buildingId}
            onChange={(e) => { setBuildingId(e.target.value); setLevelId(''); setLocationId(''); }}
          >
            <option value="">All buildings</option>
            {(hierarchyQuery.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select
            className="field-input w-auto"
            value={levelId}
            disabled={!buildingId}
            onChange={(e) => { setLevelId(e.target.value); setLocationId(''); }}
          >
            <option value="">{buildingId ? 'All levels' : 'Any level'}</option>
            {levelOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select
            className="field-input w-auto"
            value={locationId}
            disabled={!levelId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{levelId ? 'All locations' : 'Any location'}</option>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          {capturesQuery.data?.meta && (
            <span className="text-xs font-mono text-ink-500 ml-auto">
              {capturesQuery.data.meta.total} capture{capturesQuery.data.meta.total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {capturesQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-video panel animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}
        {capturesQuery.data && (
          <CaptureGrid projectId={projectId} projectName={projectQuery.data?.name} captures={capturesQuery.data.data} />
        )}
      </div>

      <CaptureUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        locations={allLocations}
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
