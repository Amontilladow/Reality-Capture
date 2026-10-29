import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { StatusBadge } from '../components/ui/Badge';
import { apiErrorMessage } from '../lib/api';
import { getProject } from '../lib/projects.api';
import {
  listSiteDrawings, getSiteDrawingFilterOptions, getSiteDrawingSourceHealth, listOfflinePackages,
  revalidateOfflinePackage, type SiteDrawingFilters, type SiteDrawingWorkflowStatus,
} from '../lib/site-drawings.api';
import {
  WORKFLOW_STATUS_LABELS, WORKFLOW_STATUS_TONE, sourceProviderLabel, formatVerifiedAt, needsApprovalWarning,
} from '../components/site-drawings/siteDrawingDisplay';
import { RegisterSiteDrawingModal } from '../components/site-drawings/RegisterSiteDrawingModal';
import { SiteDrawingDetailDrawer } from '../components/site-drawings/SiteDrawingDetailDrawer';

const PER_PAGE = 25;
const EMPTY_FILTERS: Omit<SiteDrawingFilters, 'page' | 'perPage'> = {
  search: '', discipline: '', buildingOrZone: '', floorOrLevel: '', workflowStatus: undefined,
};

export default function SiteDrawingHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

  // Search is server-side (brief section 10: indexed queries, not a
  // client-side filter over a fully fetched register) -- debounced so
  // every keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchInput })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [filters]);

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId!), enabled: Boolean(projectId) });
  const filterOptionsQuery = useQuery({ queryKey: ['site-drawing-filter-options', projectId], queryFn: () => getSiteDrawingFilterOptions(projectId!), enabled: Boolean(projectId) });
  const sourceHealthQuery = useQuery({ queryKey: ['site-drawing-source-health', projectId], queryFn: () => getSiteDrawingSourceHealth(projectId!), enabled: Boolean(projectId) });
  const offlinePackagesQuery = useQuery({ queryKey: ['site-drawing-offline-packages', projectId], queryFn: () => listOfflinePackages(projectId!), enabled: Boolean(projectId) });

  const listQuery = useQuery({
    queryKey: ['site-drawings', projectId, filters, page],
    queryFn: () => listSiteDrawings(projectId!, { ...filters, page, perPage: PER_PAGE }),
    enabled: Boolean(projectId),
  });

  // Reconnect revalidation (brief section 8): on coming back online, check
  // every locally stored package against the source for a changed,
  // superseded, or withdrawn revision -- never silently assumed still
  // current just because the bytes are sitting in IndexedDB.
  useEffect(() => {
    if (!projectId) return;
    function revalidateAll() {
      const packages = offlinePackagesQuery.data ?? [];
      Promise.all(
        packages
          .filter((p) => p.status === 'COMPLETE' || p.status === 'STALE')
          .map((p) => revalidateOfflinePackage(projectId!, p.id).catch(() => null)),
      ).finally(() => {
        queryClient.invalidateQueries({ queryKey: ['site-drawing-offline-packages', projectId] });
      });
    }
    window.addEventListener('online', revalidateAll);
    return () => window.removeEventListener('online', revalidateAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, offlinePackagesQuery.data]);

  const offlineDrawingIds = useMemo(
    () => new Set((offlinePackagesQuery.data ?? []).filter((p) => p.status === 'COMPLETE' || p.status === 'STALE').map((p) => p.drawingId)),
    [offlinePackagesQuery.data],
  );

  const total = listQuery.data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const drawings = listQuery.data?.data ?? [];
  const hasActiveFilters = Boolean(filters.search || filters.discipline || filters.buildingOrZone || filters.floorOrLevel || filters.workflowStatus);

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: projectQuery.data?.name ?? 'Loading…', to: `/projects/${projectId}` }, { label: 'Site Drawings' }]}
        title="Site Drawing Hub"
        subtitle="Discover, open and verify the latest valid construction drawings."
        actions={<button onClick={() => setRegisterOpen(true)} className="btn-primary">Register a drawing</button>}
      />
      <div className="p-6 space-y-4">
        {sourceHealthQuery.data && !sourceHealthQuery.data.reachable && (
          <div className="panel p-3 border border-warn/40 bg-warn/5 text-xs text-ink-100">
            ⚠ {sourceProviderLabel(sourceHealthQuery.data.provider)} source is currently unreachable
            {sourceHealthQuery.data.detail ? ` — ${sourceHealthQuery.data.detail}` : '.'} Drawing data shown below may be out of date.
          </div>
        )}

        <div className="panel p-3 flex items-center gap-2 flex-wrap">
          <input
            type="text" placeholder="Search drawing number, title…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="field-input w-56 text-xs !py-1.5"
          />
          <select value={filters.discipline} onChange={(e) => setFilters((f) => ({ ...f, discipline: e.target.value }))} className="field-input w-auto text-xs !py-1.5">
            <option value="">All disciplines</option>
            {(filterOptionsQuery.data?.disciplines ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filters.buildingOrZone} onChange={(e) => setFilters((f) => ({ ...f, buildingOrZone: e.target.value }))} className="field-input w-auto text-xs !py-1.5">
            <option value="">All buildings / zones</option>
            {(filterOptionsQuery.data?.buildingsOrZones ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={filters.floorOrLevel} onChange={(e) => setFilters((f) => ({ ...f, floorOrLevel: e.target.value }))} className="field-input w-auto text-xs !py-1.5">
            <option value="">All floors / levels</option>
            {(filterOptionsQuery.data?.floorsOrLevels ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            value={filters.workflowStatus ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, workflowStatus: (e.target.value || undefined) as SiteDrawingWorkflowStatus | undefined }))}
            className="field-input w-auto text-xs !py-1.5"
          >
            <option value="">All statuses</option>
            {Object.entries(WORKFLOW_STATUS_LABELS).map(([s, label]) => <option key={s} value={s}>{label}</option>)}
          </select>
          {hasActiveFilters && (
            <button onClick={() => { setSearchInput(''); setFilters(EMPTY_FILTERS); }} className="btn-ghost !px-2 !py-1 text-xs ml-auto">
              Reset filters
            </button>
          )}
        </div>

        {listQuery.isLoading && <div className="panel tick-frame p-10 text-center text-sm text-ink-500">Loading drawings…</div>}

        {listQuery.isError && (
          <div className="panel tick-frame p-10 text-center space-y-2">
            <p className="text-sm text-danger">{apiErrorMessage(listQuery.error)}</p>
            <button onClick={() => listQuery.refetch()} className="btn-secondary !px-3 !py-1.5 text-xs">Retry</button>
          </div>
        )}

        {!listQuery.isLoading && !listQuery.isError && (
          <>
            {/* Desktop/tablet: table */}
            <div className="panel tick-frame overflow-hidden hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                      <th className="px-3 py-2.5 font-medium">Drawing No.</th>
                      <th className="px-3 py-2.5 font-medium">Title</th>
                      <th className="px-3 py-2.5 font-medium">Discipline</th>
                      <th className="px-3 py-2.5 font-medium">Rev.</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Source</th>
                      <th className="px-3 py-2.5 font-medium">Last Verified</th>
                      <th className="px-3 py-2.5 font-medium">Offline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawings.map((d) => (
                      <tr key={d.id} onClick={() => setSelectedDrawingId(d.id)} className="border-b border-base-700/60 last:border-0 cursor-pointer hover:bg-base-700">
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-500 whitespace-nowrap">{d.drawingNumber}</td>
                        <td className="px-3 py-2.5 max-w-xs">
                          <div className="text-ink-100 truncate">{d.drawingTitle}</div>
                          {d.buildingOrZone && <div className="text-xs text-ink-500 truncate">{d.buildingOrZone}{d.floorOrLevel ? ` · ${d.floorOrLevel}` : ''}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-ink-300 whitespace-nowrap">{d.discipline ?? '—'}</td>
                        <td className="px-3 py-2.5 text-ink-300 whitespace-nowrap">{d.currentRevision?.revisionNumber ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge tone={WORKFLOW_STATUS_TONE[d.currentWorkflowStatus]} label={WORKFLOW_STATUS_LABELS[d.currentWorkflowStatus]} dot />
                            {needsApprovalWarning(d.currentWorkflowStatus) && <span title="Approval status needs attention">⚠</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-ink-300 whitespace-nowrap">{sourceProviderLabel(d.sourceProvider)}</td>
                        <td className="px-3 py-2.5 text-ink-500 whitespace-nowrap">{formatVerifiedAt(d.currentRevision?.lastVerifiedAt)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{offlineDrawingIds.has(d.id) && <StatusBadge tone="info" label="Offline" />}</td>
                      </tr>
                    ))}
                    {drawings.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-500">No drawings match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile: cards */}
            <div className="md:hidden space-y-2">
              {drawings.length === 0 && (
                <div className="panel tick-frame p-8 text-center text-sm text-ink-500">No drawings match the current filters.</div>
              )}
              {drawings.map((d) => (
                <button key={d.id} onClick={() => setSelectedDrawingId(d.id)} className="panel tick-frame w-full text-left p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-ink-500">{d.drawingNumber}</span>
                    <StatusBadge tone={WORKFLOW_STATUS_TONE[d.currentWorkflowStatus]} label={WORKFLOW_STATUS_LABELS[d.currentWorkflowStatus]} dot />
                  </div>
                  <div className="text-sm text-ink-100 font-medium">{d.drawingTitle}</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-500">{sourceProviderLabel(d.sourceProvider)} · Rev {d.currentRevision?.revisionNumber ?? '—'}</span>
                    {offlineDrawingIds.has(d.id) && <StatusBadge tone="info" label="Offline" />}
                  </div>
                  <div className="text-xs text-ink-500">{formatVerifiedAt(d.currentRevision?.lastVerifiedAt)}</div>
                </button>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-ink-500 px-1">
                <span>Page {page} of {totalPages} · {total} drawing{total === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost !px-2 !py-1 text-xs disabled:opacity-40">Previous</button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost !px-2 !py-1 text-xs disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {registerOpen && <RegisterSiteDrawingModal open onClose={() => setRegisterOpen(false)} projectId={projectId} />}
      {selectedDrawingId && <SiteDrawingDetailDrawer projectId={projectId} drawingId={selectedDrawingId} onClose={() => setSelectedDrawingId(null)} />}
    </>
  );
}
