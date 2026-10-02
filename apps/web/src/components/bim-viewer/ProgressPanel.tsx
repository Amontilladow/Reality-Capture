import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLevelProgressSummary, upsertZoneProgress, type BimLevelProgress } from '../../lib/bim.api';

const ZONE_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
];

function LevelRow({ projectId, level }: { projectId: string; level: BimLevelProgress }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ status: level.zoneStatus ?? 'not_started', completionPct: level.zoneCompletionPct !== null ? String(level.zoneCompletionPct) : '' });

  const mutation = useMutation({
    mutationFn: () => upsertZoneProgress(projectId, level.levelId, {
      status: draft.status,
      completionPct: draft.completionPct === '' ? undefined : Number(draft.completionPct),
    }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['bim-level-progress', projectId] });
    },
  });

  return (
    <div className="border-b border-gray-200 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{level.levelName}</div>
          <div className="text-xs text-gray-500">{level.buildingName}</div>
        </div>
        <button type="button" onClick={() => setEditing((v) => !v)} className="shrink-0 text-xs text-blue-700 hover:text-blue-900">
          {editing ? 'Close' : 'Set zone status'}
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-600">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-green-500" style={{ width: `${level.elementCompletionPct ?? 0}%` }} />
        </div>
        <span className="shrink-0 tabular-nums">{level.elementComplete}/{level.elementTotal} ({level.elementCompletionPct ?? 0}%)</span>
      </div>
      {level.zoneStatus && (
        <div className="mt-1 text-xs text-gray-500">
          Zone status: <span className="font-medium text-gray-700">{ZONE_STATUS_OPTIONS.find((o) => o.value === level.zoneStatus)?.label ?? level.zoneStatus}</span>
          {level.zoneCompletionPct !== null && ` (${level.zoneCompletionPct}%)`}
        </div>
      )}

      {editing && (
        <div className="mt-2 space-y-2 rounded border border-gray-200 p-2">
          <select
            className="field-input text-xs" value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            {ZONE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="number" min={0} max={100} placeholder="Completion %" className="field-input text-xs"
            value={draft.completionPct} onChange={(e) => setDraft({ ...draft, completionPct: e.target.value })}
          />
          {mutation.isError && <p className="text-xs text-red-600">Failed to save. Try again.</p>}
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary w-full text-xs">
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// F2 per-level summary: element completion rolled up from bim_elements
// (always live) alongside the separately-set zone_progress status (an
// office-level "this level is 80% done" call distinct from counting
// individual element statuses). Grouped by building so the building-level
// picture is just these rows read together -- no separate building query.
export function ProgressPanel({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ['bim-level-progress', projectId],
    queryFn: () => getLevelProgressSummary(projectId),
  });

  if (query.isLoading) return <p className="p-3 text-sm text-gray-400">Loading progress…</p>;
  if (!query.data || query.data.length === 0) return <p className="p-3 text-sm text-gray-400">No levels found for this project.</p>;

  const byBuilding = new Map<string, { name: string; levels: BimLevelProgress[] }>();
  for (const lvl of query.data) {
    if (!byBuilding.has(lvl.buildingId)) byBuilding.set(lvl.buildingId, { name: lvl.buildingName, levels: [] });
    byBuilding.get(lvl.buildingId)!.levels.push(lvl);
  }

  return (
    <div className="h-full overflow-y-auto">
      {[...byBuilding.values()].map((b) => (
        <div key={b.name}>
          <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{b.name}</div>
          {b.levels.map((lvl) => <LevelRow key={lvl.levelId} projectId={projectId} level={lvl} />)}
        </div>
      ))}
    </div>
  );
}
