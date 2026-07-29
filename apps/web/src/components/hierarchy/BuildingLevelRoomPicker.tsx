import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectHierarchy } from '../../lib/projects.api';
import { createBuilding, createLevel, createLocation } from '../../lib/projects.api';
import { apiErrorMessage } from '../../lib/api';

export interface HierarchySelection {
  buildingId: string;
  levelId: string;
  locationId: string;
}

export function BuildingLevelRoomPicker({
  projectId,
  hierarchy,
  value,
  onChange,
}: {
  projectId: string;
  hierarchy: ProjectHierarchy[];
  value: HierarchySelection;
  onChange: (v: HierarchySelection) => void;
}) {
  const queryClient = useQueryClient();

  const building = hierarchy.find((b) => b.id === value.buildingId);
  const level = building?.levels?.find((l) => l.id === value.levelId);

  function invalidateHierarchy() {
    return queryClient.invalidateQueries({ queryKey: ['hierarchy', projectId] });
  }

  const createBuildingMutation = useMutation({
    mutationFn: (name: string) => createBuilding(projectId, { name }),
    onSuccess: async (b) => {
      await invalidateHierarchy();
      onChange({ buildingId: b.id, levelId: '', locationId: '' });
    },
  });

  const createLevelMutation = useMutation({
    mutationFn: (name: string) =>
      createLevel(projectId, value.buildingId, { name, levelOrder: building?.levels.length ?? 0 }),
    onSuccess: async (l) => {
      await invalidateHierarchy();
      onChange({ ...value, levelId: l.id, locationId: '' });
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: (name: string) => createLocation(projectId, value.buildingId, value.levelId, { name }),
    onSuccess: async (loc) => {
      await invalidateHierarchy();
      onChange({ ...value, locationId: loc.id });
    },
  });

  return (
    <div className="grid grid-cols-3 gap-3">
      <PickOrCreate
        label="Building"
        placeholder="Unassigned"
        options={hierarchy.map((b) => ({ id: b.id, name: b.name }))}
        value={value.buildingId}
        onSelect={(id) => onChange({ buildingId: id, levelId: '', locationId: '' })}
        onCreate={(name) => createBuildingMutation.mutateAsync(name)}
        creating={createBuildingMutation.isPending}
        error={createBuildingMutation.isError ? apiErrorMessage(createBuildingMutation.error) : undefined}
      />
      <PickOrCreate
        label="Level"
        placeholder={value.buildingId ? 'Unassigned' : 'Pick a building first'}
        options={(building?.levels ?? []).map((l) => ({ id: l.id, name: l.name }))}
        value={value.levelId}
        disabled={!value.buildingId}
        onSelect={(id) => onChange({ ...value, levelId: id, locationId: '' })}
        onCreate={(name) => createLevelMutation.mutateAsync(name)}
        creating={createLevelMutation.isPending}
        error={createLevelMutation.isError ? apiErrorMessage(createLevelMutation.error) : undefined}
      />
      <PickOrCreate
        label="Room (optional)"
        placeholder={value.levelId ? 'None' : 'Pick a level first'}
        options={(level?.locations ?? []).map((l) => ({ id: l.id, name: l.name }))}
        value={value.locationId}
        disabled={!value.levelId}
        onSelect={(id) => onChange({ ...value, locationId: id })}
        onCreate={(name) => createLocationMutation.mutateAsync(name)}
        creating={createLocationMutation.isPending}
        error={createLocationMutation.isError ? apiErrorMessage(createLocationMutation.error) : undefined}
      />
    </div>
  );
}

function PickOrCreate({
  label,
  placeholder,
  options,
  value,
  disabled,
  onSelect,
  onCreate,
  creating,
  error,
}: {
  label: string;
  placeholder: string;
  options: { id: string; name: string }[];
  value: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<unknown>;
  creating: boolean;
  error?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function submit() {
    if (!name.trim()) return;
    await onCreate(name.trim());
    setName('');
    setAdding(false);
  }

  return (
    <div>
      <label className="field-label">{label}</label>
      {adding ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            className="field-input"
            placeholder="Name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
          />
          <button type="button" onClick={submit} disabled={!name.trim() || creating} className="btn-primary !px-2.5 shrink-0">
            {creating ? '…' : 'Add'}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="btn-ghost !px-2 shrink-0">✕</button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <select
            className="field-input"
            disabled={disabled}
            value={value}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">{placeholder}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={disabled}
            className="btn-secondary !px-2.5 shrink-0"
            title={`New ${label.toLowerCase()}`}
            aria-label={`New ${label.toLowerCase()}`}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
