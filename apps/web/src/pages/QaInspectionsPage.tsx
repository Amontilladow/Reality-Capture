import aPlus from 'react-useanimations/lib/plusCircle';
import { AnimatedButton } from '../components/ui/AnimatedIcon';
import aTrash from 'react-useanimations/lib/trash2';
import { confirmDialog } from '../store/confirm.store';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePage } from '../lib/usePage';
import { QaInspectionFormModal } from '../components/QaInspectionFormModal';
import { QaInspectionDetailModal } from '../components/QaInspectionDetailModal';
import { listInspections, getQaSummary, bulkDeleteInspections } from '../lib/qa.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  QA_STATUSES, QA_STATUS_LABELS, QA_STATUS_BADGE_CLASS, formatDate,
} from '../lib/qa-constants';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from '../components/ui/Listbox';

export default function QaInspectionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  // ?new=1 (the Overview's quick actions) opens the form straight away.
  const [newParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(newParams.get('new') === '1');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const summaryQuery = useQuery({
    queryKey: ['qa-summary', projectId],
    queryFn: () => getQaSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const [page, setPage] = usePage(['qa-inspections', projectId, status]);
  const inspectionsQuery = useQuery({
    queryKey: ['qa-inspections', projectId, status, page],
    queryFn: () => listInspections(projectId!, { page, perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  // Derived from the live query result, not a click-time snapshot, so the
  // detail modal reflects a status change immediately instead of showing
  // stale data until it's closed and reopened.
  const selected = selectedId ? (inspectionsQuery.data?.data ?? []).find((i) => i.id === selectedId) ?? null : null;

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteInspections(projectId!, [...selectedIds]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qa-inspections', projectId] });
      queryClient.invalidateQueries({ queryKey: ['qa-summary', projectId] });
      setSelectedIds(new Set());
    },
  });

  if (!projectId) return null;

  const inspectionRows = inspectionsQuery.data?.data ?? [];
  const allSelected = inspectionRows.length > 0 && selectedIds.size === inspectionRows.length;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="QA/QC"
        actions={
          <AnimatedButton animation={aPlus} onClick={() => setCreateOpen(true)} className="btn-primary">
            New inspection
          </AnimatedButton>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Listbox aria-label="Status" className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {QA_STATUSES.map((s) => (
              <option key={s} value={s}>{QA_STATUS_LABELS[s]}</option>
            ))}
          </Listbox>

          {summaryQuery.data && (
            <div className="flex gap-4 text-xs tabular-nums text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>{summaryQuery.data.pending} pending</span>
              <span>{summaryQuery.data.passed} passed</span>
              <span className={summaryQuery.data.failed > 0 ? 'text-danger' : ''}>{summaryQuery.data.failed} failed</span>
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 tick-frame panel px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <AnimatedButton animation={aTrash} interaction="hover"
              onClick={async () => { if (await confirmDialog(`Delete ${selectedIds.size} inspection(s)? This cannot be undone.`)) bulkDeleteMutation.mutate(); }}
              disabled={bulkDeleteMutation.isPending}
              className="btn-danger !px-4 !py-2 text-sm ml-auto"
            >
              {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
            </AnimatedButton>
            {bulkDeleteMutation.isError && <span className="text-xs text-danger">{apiErrorMessage(bulkDeleteMutation.error)}</span>}
          </div>
        )}

        {inspectionsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {inspectionsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No inspections yet. Schedule a quality check against a scope of work.
          </div>
        )}

        {(inspectionsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-x-auto" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2 font-medium w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelectedIds(allSelected ? new Set() : new Set(inspectionRows.map((i) => i.id)))}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Inspector</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {inspectionRows.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setSelectedId(i.id)}
                    className="border-b border-base-700/60 last:border-0 hover:bg-base-700 cursor-pointer"
                  >
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(i.id)}
                        onChange={() => setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(i.id)) next.delete(i.id); else next.add(i.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-500">{i.inspectionNumber ?? '—'}</td>
                    <td className="px-4 py-2">{i.title}</td>
                    <td className="px-4 py-2 text-ink-300">{i.inspectionType ?? '—'}</td>
                    <td className="px-4 py-2 text-ink-300">{i.location ?? '—'}</td>
                    <td className="px-4 py-2"><span className={`badge ${QA_STATUS_BADGE_CLASS[i.status]}`}>{QA_STATUS_LABELS[i.status]}</span></td>
                    <td className="px-4 py-2 text-ink-300">{i.assignedToName ?? 'Unassigned'}</td>
                    <td className="px-4 py-2 text-ink-300">{formatDate(i.inspectionDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inspectionsQuery.data?.meta && (
          <div className="mt-4">
            <Pagination page={page} pageSize={inspectionsQuery.data.meta.perPage} total={inspectionsQuery.data.meta.total} onPageChange={setPage} />
          </div>
        )}
      </div>

      <QaInspectionFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
      <QaInspectionDetailModal open={Boolean(selected)} onClose={() => setSelectedId(null)} projectId={projectId} inspection={selected} />
    </>
  );
}
