import { Fragment, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { SnagItemFormModal } from '../components/SnagItemFormModal';
import { SnagDetail } from '../components/SnagDetail';
import { listSnagItems, getSnagSummary, type SnagListItem } from '../lib/snagging.api';
import { getProject, getMembers, getHierarchy, type ProjectHierarchy } from '../lib/projects.api';
import {
  SNAG_STATUSES, SNAG_STATUS_LABELS, SNAG_STATUS_BADGE_CLASS,
  SNAG_PRIORITY_LABELS, SNAG_PRIORITY_BADGE_CLASS, isSnagOverdue, formatDate,
} from '../lib/snagging-constants';

export default function SnaggingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editSnag, setEditSnag] = useState<SnagListItem | null>(null);
  const [viewSnagId, setViewSnagId] = useState<string | null>(searchParams.get('snagId'));

  // ── Building/level grouping (same treatment as Floor plans/Issues) --
  // snag_items.building_id/level_id are joined into buildingName/levelName
  // server-side (snagging.service.ts findAll()); the hierarchy tree here is
  // only needed for building/level ORDER (levelOrder) and to scope the
  // Level filter's options to the selected building.
  const [buildingFilter, setBuildingFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const summaryQuery = useQuery({
    queryKey: ['snag-summary', projectId],
    queryFn: () => getSnagSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const snagItemsQuery = useQuery({
    queryKey: ['snag-items', projectId, status],
    queryFn: () => listSnagItems(projectId!, { perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  const hierarchy = useMemo(() => hierarchyQuery.data ?? [], [hierarchyQuery.data]);

  type SnagWithLocation = SnagListItem & {
    _building?: ProjectHierarchy;
    _level?: ProjectHierarchy['levels'][number];
  };

  // Resolves each snag item's building/level objects from the hierarchy
  // tree (for levelOrder sorting) -- a snag whose buildingId/levelId points
  // at a building/level no longer in the tree resolves the same as one
  // with no building at all, and falls into "Unassigned" below.
  const snagsWithLocation = useMemo<SnagWithLocation[]>(() => {
    return (snagItemsQuery.data?.data ?? []).map((snag) => {
      if (!snag.buildingId) return snag;
      const building = hierarchy.find((b) => b.id === snag.buildingId);
      if (!building) return snag;
      const level = snag.levelId ? building.levels.find((l) => l.id === snag.levelId) : undefined;
      return { ...snag, _building: building, _level: level };
    });
  }, [snagItemsQuery.data, hierarchy]);

  const levelOptionsForFilter = useMemo(() => {
    const building = hierarchy.find((b) => b.id === buildingFilter);
    return [...(building?.levels ?? [])].sort((a, b) => a.levelOrder - b.levelOrder);
  }, [hierarchy, buildingFilter]);

  const filteredSnags = useMemo(() => {
    return snagsWithLocation.filter((snag) => {
      if (buildingFilter && snag._building?.id !== buildingFilter) return false;
      if (levelFilter && snag.levelId !== levelFilter) return false;
      return true;
    });
  }, [snagsWithLocation, buildingFilter, levelFilter]);

  // Grouped for render: buildings in hierarchy order, levels within each
  // sorted by levelOrder (not name), "Unassigned" bucket last -- same
  // structure as FloorPlanViewer.tsx's/IssuesPage.tsx's grouping.
  const groupedSnags = useMemo(() => {
    const byBuilding = new Map<string, Map<string, { level?: ProjectHierarchy['levels'][number]; snags: SnagWithLocation[] }>>();
    const unassigned: SnagWithLocation[] = [];

    for (const snag of filteredSnags) {
      if (!snag._building) {
        unassigned.push(snag);
        continue;
      }
      if (!byBuilding.has(snag._building.id)) byBuilding.set(snag._building.id, new Map());
      const levelMap = byBuilding.get(snag._building.id)!;
      const levelKey = snag._level?.id ?? '__no-level__';
      if (!levelMap.has(levelKey)) levelMap.set(levelKey, { level: snag._level, snags: [] });
      levelMap.get(levelKey)!.snags.push(snag);
    }

    const buildingGroups = hierarchy
      .filter((b) => byBuilding.has(b.id))
      .map((b) => ({
        building: b,
        levelGroups: [...byBuilding.get(b.id)!.values()].sort(
          (a, b2) => (a.level?.levelOrder ?? Infinity) - (b2.level?.levelOrder ?? Infinity),
        ),
      }));

    return { buildingGroups, unassigned };
  }, [filteredSnags, hierarchy]);

  if (!projectId) return null;

  if (viewSnagId) {
    return (
      <>
        <PageHeader eyebrow="Project" title="Snag item detail" />
        <SnagDetail
          projectId={projectId}
          snagId={viewSnagId}
          onBack={() => setViewSnagId(null)}
          onEdit={(snag) => setEditSnag(snag)}
        />
        <SnagItemFormModal
          open={Boolean(editSnag)}
          onClose={() => setEditSnag(null)}
          projectId={projectId}
          members={membersQuery.data ?? []}
          hierarchy={hierarchy}
          snag={editSnag ?? undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Snagging"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + New snag item
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="field-input w-auto"
            value={buildingFilter}
            onChange={(e) => { setBuildingFilter(e.target.value); setLevelFilter(''); }}
          >
            <option value="">All buildings</option>
            {hierarchy.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select
            className="field-input w-auto"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            disabled={!buildingFilter}
          >
            <option value="">{buildingFilter ? 'All levels' : 'Pick a building first'}</option>
            {levelOptionsForFilter.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {SNAG_STATUSES.map((s) => (
              <option key={s} value={s}>{SNAG_STATUS_LABELS[s]}</option>
            ))}
          </select>

          {summaryQuery.data && (
            <div className="flex gap-2 text-[10px] font-mono text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>·</span>
              <span>{summaryQuery.data.open} open</span>
              <span>·</span>
              <span>{summaryQuery.data.fixed} fixed</span>
              <span>·</span>
              <span>{summaryQuery.data.verified} verified</span>
              <span>·</span>
              <span className={summaryQuery.data.overdue > 0 ? 'text-danger' : ''}>{summaryQuery.data.overdue} overdue</span>
            </div>
          )}
        </div>

        {snagItemsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {snagItemsQuery.isSuccess && (snagItemsQuery.data?.data.length ?? 0) === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No snag items yet. Log a punch-list item found during a walkthrough.
          </div>
        )}

        {snagItemsQuery.isSuccess && (snagItemsQuery.data?.data.length ?? 0) > 0 && filteredSnags.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No snag items match these filters.
          </div>
        )}

        {/* Grouped by building -> level (same treatment as Floor plans/
            Issues) -- one table per building, a level sub-header row inside,
            "Unassigned" table last for items with no building or a deleted
            one. */}
        <div className="space-y-3">
          {groupedSnags.buildingGroups.map(({ building, levelGroups }) => (
            <details key={building.id} open>
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-ink-500 px-1 py-1.5 hover:text-ink-300">
                {building.name}
              </summary>
              <div className="panel tick-frame overflow-hidden mt-1">
                <SnagTable levelGroups={levelGroups} onRowClick={setViewSnagId} />
              </div>
            </details>
          ))}

          {groupedSnags.unassigned.length > 0 && (
            <details open>
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-ink-500 px-1 py-1.5 hover:text-ink-300">
                Unassigned
              </summary>
              <div className="panel tick-frame overflow-hidden mt-1">
                <SnagTable levelGroups={[{ level: undefined, snags: groupedSnags.unassigned }]} onRowClick={setViewSnagId} hideLevelHeader />
              </div>
            </details>
          )}
        </div>
      </div>

      <SnagItemFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} hierarchy={hierarchy} />
    </>
  );
}

// Shared by every building group (and the Unassigned bucket, as a single
// level-less group) -- one table with its own column headers, a lightweight
// level sub-header row inside the body per level, and each snag item's
// exact original <tr> markup/onClick behavior, unchanged.
function SnagTable({
  levelGroups,
  onRowClick,
  hideLevelHeader,
}: {
  levelGroups: { level?: ProjectHierarchy['levels'][number]; snags: SnagListItem[] }[];
  onRowClick: (id: string) => void;
  hideLevelHeader?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-ink-500 border-b border-base-600">
          <th className="px-4 py-2.5 font-medium">Number</th>
          <th className="px-4 py-2.5 font-medium">Title</th>
          <th className="px-4 py-2.5 font-medium">Location</th>
          <th className="px-4 py-2.5 font-medium">Trade</th>
          <th className="px-4 py-2.5 font-medium">Status</th>
          <th className="px-4 py-2.5 font-medium">Priority</th>
          <th className="px-4 py-2.5 font-medium">Due</th>
        </tr>
      </thead>
      <tbody>
        {levelGroups.map((group) => (
          <Fragment key={group.level?.id ?? '__no-level__'}>
            {!hideLevelHeader && (
              <tr>
                <td colSpan={7} className="px-4 py-1 text-[11px] font-medium text-ink-500 bg-base-800/40">
                  {group.level?.name ?? 'No level'}
                </td>
              </tr>
            )}
            {group.snags.map((s) => (
              <SnagRow key={s.id} snag={s} onClick={() => onRowClick(s.id)} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function SnagRow({ snag: s, onClick }: { snag: SnagListItem; onClick: () => void }) {
  const overdue = isSnagOverdue(s.dueDate, s.status);
  return (
    <tr onClick={onClick} className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer">
      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{s.snagNumber ?? '—'}</td>
      <td className="px-4 py-2.5">{s.title}</td>
      <td className="px-4 py-2.5 text-ink-300">{s.location ?? '—'}</td>
      <td className="px-4 py-2.5 text-ink-300">{s.trade ?? '—'}</td>
      <td className="px-4 py-2.5"><span className={`badge ${SNAG_STATUS_BADGE_CLASS[s.status]}`}>{SNAG_STATUS_LABELS[s.status]}</span></td>
      <td className="px-4 py-2.5"><span className={`badge ${SNAG_PRIORITY_BADGE_CLASS[s.priority]}`}>{SNAG_PRIORITY_LABELS[s.priority]}</span></td>
      <td className={`px-4 py-2.5 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(s.dueDate)}</td>
    </tr>
  );
}
