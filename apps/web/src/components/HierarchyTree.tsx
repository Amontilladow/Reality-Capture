import { useState } from 'react';
import type { ProjectPhase } from '@engineeringos/types';
import type { ProjectHierarchy } from '../lib/projects.api';
import { PhaseEditor } from './PhaseEditor';

export function HierarchyTree({
  buildings,
  selectedLocationId,
  onSelectLocation,
  onAddLevel,
  onAddLocation,
  onSetBuildingPhase,
  buildingPhaseSaving,
}: {
  buildings: ProjectHierarchy[];
  selectedLocationId?: string;
  onSelectLocation: (locationId: string, locationName: string) => void;
  onAddLevel?: (buildingId: string) => void;
  onAddLocation?: (buildingId: string, levelId: string) => void;
  onSetBuildingPhase?: (buildingId: string, phase: ProjectPhase | '') => void;
  buildingPhaseSaving?: boolean;
}) {
  const [openBuildings, setOpenBuildings] = useState<Set<string>>(new Set(buildings.map((b) => b.id)));
  const [openLevels, setOpenLevels] = useState<Set<string>>(new Set());

  function toggleBuilding(id: string) {
    setOpenBuildings((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleLevel(id: string) {
    setOpenLevels((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (buildings.length === 0) {
    return <div className="text-sm text-ink-500 px-1 py-4">No buildings added yet.</div>;
  }

  return (
    <div className="space-y-1">
      {buildings.map((building) => (
        <div key={building.id}>
          <div className="flex items-center group">
            <button
              onClick={() => toggleBuilding(building.id)}
              className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-base-800 text-left min-w-0"
            >
              <Chevron open={openBuildings.has(building.id)} />
              <BuildingIcon className="w-4 h-4 text-blueprint shrink-0" />
              <span className="font-medium truncate">{building.name}</span>
            </button>
            {onAddLevel && (
              <button
                onClick={() => onAddLevel(building.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-blueprint px-1.5 transition-opacity"
                title="Add level"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {onSetBuildingPhase && (
            <div className="ml-6 mb-1">
              <PhaseEditor
                phase={building.phase}
                onSave={(phase) => onSetBuildingPhase(building.id, phase)}
                saving={buildingPhaseSaving}
              />
            </div>
          )}

          {openBuildings.has(building.id) && (
            <div className="ml-4 pl-3 border-l border-base-600 space-y-1 mt-0.5">
              {(building.levels ?? []).length === 0 && (
                <div className="text-xs text-ink-500 px-2 py-1">No levels yet</div>
              )}
              {(building.levels ?? []).map((level) => (
                <div key={level.id}>
                  <div className="flex items-center group">
                    <button
                      onClick={() => toggleLevel(level.id)}
                      className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-base-800 text-left min-w-0"
                    >
                      <Chevron open={openLevels.has(level.id)} />
                      <LevelIcon className="w-3.5 h-3.5 text-ink-500 shrink-0" />
                      <span className="truncate">{level.name}</span>
                    </button>
                    {onAddLocation && (
                      <button
                        onClick={() => onAddLocation(building.id, level.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-blueprint px-1.5 transition-opacity"
                        title="Add location"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {openLevels.has(level.id) && (
                    <div className="ml-4 pl-3 border-l border-base-600 space-y-0.5 mt-0.5">
                      {(level.locations ?? []).length === 0 && (
                        <div className="text-xs text-ink-500 px-2 py-1">No locations yet</div>
                      )}
                      {(level.locations ?? []).map((location) => (
                        <button
                          key={location.id}
                          onClick={() => onSelectLocation(location.id, location.name)}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                            selectedLocationId === location.id
                              ? 'bg-signal/10 text-signal'
                              : 'text-ink-300 hover:bg-base-800 hover:text-ink-100'
                          }`}
                        >
                          <span className="truncate">{location.name}</span>
                          {(location.captureCount ?? 0) > 0 && (
                            <span className="text-[10px] font-mono text-ink-500 shrink-0">
                              {location.captureCount}
                            </span>
                          )}
                        </button>
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
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-3.5 h-3.5 shrink-0 text-ink-500 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
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
