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

const PER_PAGE = 60;

export default function CapturesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [captureType, setCaptureType] = useState('');
  const [phase, setPhase] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
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
    queryKey: ['captures', projectId, 'all', captureType, phase, buildingId, levelId, locationId, search, sortOrder, page],
    queryFn: () =>
      listCaptures(projectId!, {
        page,
        perPage: PER_PAGE,
        captureType: captureType || undefined,
        phase: phase || undefined,
        buildingId: buildingId || undefined,
        levelId: levelId || undefined,
        locationId: locationId || undefined,
        search: search || undefined,
        sortOrder,
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

  const hasActiveFilters = Boolean(captureType || phase || buildingId || levelId || locationId || search);

  const meta = capturesQuery.data?.meta;

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
        <div className="panel p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 items-end">
          <div>
            <label className="field-label" htmlFor="fCaptureType">Type</label>
            <select
              id="fCaptureType"
              className="field-input"
              value={captureType}
              onChange={(e) => { setCaptureType(e.target.value); setPage(1); }}
            >
              {CAPTURE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="fPhase">Phase</label>
            <select
              id="fPhase"
              className="field-input"
              value={phase}
              onChange={(e) => { setPhase(e.target.value); setPage(1); }}
            >
              <option value="">All phases</option>
              {PROJECT_PHASES.map((p) => (
                <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="fBuilding">Building</label>
            <select
              id="fBuilding"
              className="field-input"
              value={buildingId}
              onChange={(e) => { setBuildingId(e.target.value); setLevelId(''); setLocationId(''); setPage(1); }}
            >
              <option value="">All buildings</option>
              {(hierarchyQuery.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="fLevel">Level</label>
            <select
              id="fLevel"
              className="field-input"
              value={levelId}
              disabled={!buildingId}
              onChange={(e) => { setLevelId(e.target.value); setLocationId(''); setPage(1); }}
            >
              <option value="">{buildingId ? 'All levels' : 'Any level'}</option>
              {levelOptions.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="fLocation">Location</label>
            <select
              id="fLocation"
              className="field-input"
              value={locationId}
              disabled={!levelId}
              onChange={(e) => { setLocationId(e.target.value); setPage(1); }}
            >
              <option value="">{levelId ? 'All locations' : 'Any location'}</option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="fSearch">Search</label>
            <input
              id="fSearch"
              className="field-input"
              placeholder="Search title…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="fSort">Sort</label>
            <select
              id="fSort"
              className="field-input"
              value={sortOrder}
              onChange={(e) => { setSortOrder(e.target.value as 'desc' | 'asc'); setPage(1); }}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
        </div>

        {meta && (
          <div className="text-xs font-mono text-ink-500">
            {meta.total} capture{meta.total === 1 ? '' : 's'}
          </div>
        )}

        {capturesQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-video panel animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}
        {capturesQuery.data && (
          <CaptureGrid
            projectId={projectId}
            projectName={projectQuery.data?.name}
            captures={capturesQuery.data.data}
            hasActiveFilters={hasActiveFilters}
          />
        )}

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              className="btn-secondary !px-3 !py-1.5 text-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
            >
              Previous
            </button>
            <span className="text-xs text-ink-500 font-mono">
              Page {meta.page} of {meta.totalPages}
            </span>
            <button
              className="btn-secondary !px-3 !py-1.5 text-xs"
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={meta.page >= meta.totalPages}
            >
              Next
            </button>
          </div>
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
