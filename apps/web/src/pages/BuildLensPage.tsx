import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { listAllPhoto360Captures } from '../lib/buildlens.api';
import { getProject, getHierarchy, type ProjectHierarchy } from '../lib/projects.api';

interface LocationSummary {
  locationId: string;
  label: string;
  count: number;
  mostRecent: string;
}

type SortMode = 'recent' | 'alpha';

function sortLocations(rows: LocationSummary[], mode: SortMode): LocationSummary[] {
  const sorted = [...rows];
  if (mode === 'alpha') {
    sorted.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    sorted.sort((a, b) => new Date(b.mostRecent).getTime() - new Date(a.mostRecent).getTime());
  }
  return sorted;
}

export default function BuildLensPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [openBuildings, setOpenBuildings] = useState<Set<string>>(new Set());
  const [openLevels, setOpenLevels] = useState<Set<string>>(new Set());

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  // getHierarchy() only returns level-anchored locations (locations.level_id
  // IS NOT NULL, per projects.service.ts's getHierarchy() query) -- a
  // location reached via a floor-plan pin's drawing_id instead never
  // appears here. That's exactly why the "Unassigned" section below exists:
  // any 360° capture whose location doesn't turn up in this tree still gets
  // shown, just not nested under a building/level.
  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const capturesQuery = useQuery({
    queryKey: ['buildlens', 'locations', projectId],
    queryFn: () => listAllPhoto360Captures(projectId!),
    enabled: Boolean(projectId),
  });

  // Per-location 360°-capture count/most-recent-date, keyed by locationId.
  // Deliberately separate from getHierarchy()'s own location.captureCount --
  // that field counts every capture type at a location, not just photo_360,
  // and carries no date at all, so it can't drive this page on its own.
  const summaryByLocation = useMemo(() => {
    const map = new Map<string, LocationSummary>();
    for (const c of capturesQuery.data ?? []) {
      if (!c.locationId) continue; // unassigned captures have nowhere to timeline
      const existing = map.get(c.locationId);
      const label = c.locationName || [c.buildingName, c.levelName].filter(Boolean).join(' · ') || 'Unnamed location';
      if (!existing) {
        map.set(c.locationId, { locationId: c.locationId, label, count: 1, mostRecent: c.capturedAt });
      } else {
        existing.count += 1;
        if (new Date(c.capturedAt).getTime() > new Date(existing.mostRecent).getTime()) {
          existing.mostRecent = c.capturedAt;
        }
      }
    }
    return map;
  }, [capturesQuery.data]);

  // Prunes the full building/level hierarchy down to just the buildings ->
  // levels -> locations that actually have a 360° capture, tracking which
  // locationIds got "claimed" this way so the Unassigned section (below)
  // knows which summaries are left over.
  const { prunedBuildings, claimedLocationIds } = useMemo(() => {
    const claimed = new Set<string>();
    const buildings = (hierarchyQuery.data ?? [])
      .map((b: ProjectHierarchy) => {
        const levels = (b.levels ?? [])
          .map((l) => {
            const locations = (l.locations ?? []).filter((loc) => summaryByLocation.has(loc.id));
            locations.forEach((loc) => claimed.add(loc.id));
            return { ...l, locations };
          })
          .filter((l) => l.locations.length > 0);
        return { ...b, levels };
      })
      .filter((b) => b.levels.length > 0);
    return { prunedBuildings: buildings, claimedLocationIds: claimed };
  }, [hierarchyQuery.data, summaryByLocation]);

  const unassigned = useMemo(() => {
    const rows: LocationSummary[] = [];
    for (const [locationId, summary] of summaryByLocation) {
      if (!claimedLocationIds.has(locationId)) rows.push(summary);
    }
    return sortLocations(rows, sortMode);
  }, [summaryByLocation, claimedLocationIds, sortMode]);

  const isLoading = capturesQuery.isLoading || hierarchyQuery.isLoading;
  const isEmpty =
    capturesQuery.isSuccess && hierarchyQuery.isSuccess &&
    prunedBuildings.length === 0 && unassigned.length === 0;

  function toggleBuilding(id: string) {
    setOpenBuildings((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleLevel(id: string) {
    setOpenLevels((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function goToLocation(locationId: string) {
    navigate(`/projects/${projectId}/buildlens/${locationId}`);
  }

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="BuildLens" />

      <div className="p-6 space-y-4 max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-ink-500">See the project evolve.</p>
          {!isEmpty && !isLoading && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-500 mr-1">Sort</span>
              {(['recent', 'alpha'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    sortMode === mode ? 'bg-signal/15 text-signal' : 'text-ink-500 hover:text-ink-100 hover:bg-base-800'
                  }`}
                >
                  {mode === 'recent' ? 'Most recent' : 'A–Z'}
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 panel animate-pulse bg-base-700/40" />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="panel p-8 text-center text-sm text-ink-500">
            No location has any 360° captures yet. Upload 360° captures to a location to build its timeline.
          </div>
        )}

        {prunedBuildings.length > 0 && (
          <div className="panel tick-frame p-2">
            {prunedBuildings.map((building) => (
              <div key={building.id}>
                <button
                  onClick={() => toggleBuilding(building.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-base-800 text-left"
                >
                  <Chevron open={openBuildings.has(building.id)} />
                  <BuildingIcon className="w-4 h-4 text-blueprint shrink-0" />
                  <span className="font-medium truncate">{building.name}</span>
                </button>

                {openBuildings.has(building.id) && (
                  <div className="ml-4 pl-3 border-l border-base-600 space-y-0.5 mt-0.5 mb-1">
                    {building.levels.map((level) => (
                      <div key={level.id}>
                        <button
                          onClick={() => toggleLevel(level.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-base-800 text-left"
                        >
                          <Chevron open={openLevels.has(level.id)} />
                          <LevelIcon className="w-3.5 h-3.5 text-ink-500 shrink-0" />
                          <span className="truncate">{level.name}</span>
                        </button>

                        {openLevels.has(level.id) && (
                          <div className="ml-4 pl-3 border-l border-base-600 space-y-0.5 mt-0.5 mb-1">
                            {sortLocations(
                              level.locations.map((loc) => summaryByLocation.get(loc.id)!),
                              sortMode,
                            ).map((loc) => (
                              <LocationRow key={loc.locationId} loc={loc} onClick={() => goToLocation(loc.locationId)} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {unassigned.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs font-mono uppercase tracking-widest text-ink-500">Unassigned</span>
              <span className="text-[10px] text-ink-500" title="Locations reached from a floor-plan pin rather than the building/level hierarchy">
                (not in a building/level)
              </span>
            </div>
            <div className="panel tick-frame overflow-hidden divide-y divide-base-600">
              {unassigned.map((loc) => (
                <LocationRow key={loc.locationId} loc={loc} onClick={() => goToLocation(loc.locationId)} wide />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function LocationRow({ loc, onClick, wide }: { loc: LocationSummary; onClick: () => void; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 text-left transition-colors hover:bg-base-800 rounded ${
        wide ? 'px-4 py-3' : 'px-2 py-1.5'
      }`}
    >
      <TimelineIcon className="w-4 h-4 text-blueprint shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{loc.label}</div>
        <div className="text-xs text-ink-500 mt-0.5">
          {loc.count} 360° capture{loc.count === 1 ? '' : 's'} · most recent{' '}
          {new Date(loc.mostRecent).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
      </div>
      <ChevronIcon className="w-4 h-4 text-ink-500 shrink-0" />
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 shrink-0 text-ink-500 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" strokeLinecap="round" />
    </svg>
  );
}
function LevelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 12h18M3 12l4-4M3 12l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TimelineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 12h4l2-6 4 12 2-6h6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
