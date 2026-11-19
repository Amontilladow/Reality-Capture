import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { usePage } from '../lib/usePage';
import { TransmittalFormModal } from '../components/TransmittalFormModal';
import { TransmittalDetailModal } from '../components/TransmittalDetailModal';
import { listTransmittals, getTransmittalSummary, bulkDeleteTransmittals } from '../lib/transmittals.api';
import { getProject } from '../lib/projects.api';
import {
  TRANSMITTAL_STATUSES, TRANSMITTAL_STATUS_LABELS, TRANSMITTAL_STATUS_BADGE_CLASS,
  TRANSMITTAL_PURPOSE_LABELS, formatDate,
} from '../lib/transmittal-constants';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from '../components/ui/Listbox';

export default function TransmittalsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const summaryQuery = useQuery({
    queryKey: ['transmittal-summary', projectId],
    queryFn: () => getTransmittalSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const [page, setPage] = usePage(['transmittals', projectId, status]);
  const transmittalsQuery = useQuery({
    queryKey: ['transmittals', projectId, status, page],
    queryFn: () => listTransmittals(projectId!, { page, perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  // Derived from the live query result (not a click-time snapshot) so the
  // detail modal reflects a status change immediately instead of showing
  // stale data until it's closed and reopened.
  const selected = selectedId ? (transmittalsQuery.data?.data ?? []).find((t) => t.id === selectedId) ?? null : null;

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteTransmittals(projectId!, [...selectedIds]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transmittals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['transmittal-summary', projectId] });
      setSelectedIds(new Set());
    },
  });

  if (!projectId) return null;

  const transmittalRows = transmittalsQuery.data?.data ?? [];
  const allSelected = transmittalRows.length > 0 && selectedIds.size === transmittalRows.length;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Transmittals"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + New transmittal
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Listbox aria-label="Status" className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TRANSMITTAL_STATUSES.map((s) => (
              <option key={s} value={s}>{TRANSMITTAL_STATUS_LABELS[s]}</option>
            ))}
          </Listbox>

          {summaryQuery.data && (
            <div className="flex gap-4 text-xs tabular-nums text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>{summaryQuery.data.draft} draft</span>
              <span>{summaryQuery.data.sent} sent</span>
              <span>{summaryQuery.data.acknowledged} acknowledged</span>
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 tick-frame panel px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <button
              onClick={() => { if (confirm(`Delete ${selectedIds.size} transmittal(s)? This cannot be undone.`)) bulkDeleteMutation.mutate(); }}
              disabled={bulkDeleteMutation.isPending}
              className="btn-danger !px-4 !py-2 text-sm ml-auto"
            >
              {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
            </button>
            {bulkDeleteMutation.isError && <span className="text-xs text-danger">{apiErrorMessage(bulkDeleteMutation.error)}</span>}
          </div>
        )}

        {transmittalsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {transmittalsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No transmittals yet. Log a set of drawings or documents being sent out.
          </div>
        )}

        {(transmittalsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-x-auto" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2 font-medium w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelectedIds(allSelected ? new Set() : new Set(transmittalRows.map((t) => t.id)))}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Recipient</th>
                  <th className="px-4 py-2 font-medium">Purpose</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody>
                {transmittalRows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="border-b border-base-700/60 last:border-0 hover:bg-base-700 cursor-pointer"
                  >
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-500">{t.transmittalNumber ?? '—'}</td>
                    <td className="px-4 py-2">{t.subject}</td>
                    <td className="px-4 py-2 text-ink-300">{t.recipientName}{t.recipientCompany ? ` (${t.recipientCompany})` : ''}</td>
                    <td className="px-4 py-2 text-ink-300">{TRANSMITTAL_PURPOSE_LABELS[t.purpose]}</td>
                    <td className="px-4 py-2"><span className={`badge ${TRANSMITTAL_STATUS_BADGE_CLASS[t.status]}`}>{TRANSMITTAL_STATUS_LABELS[t.status]}</span></td>
                    <td className="px-4 py-2 text-ink-300">{formatDate(t.sentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {transmittalsQuery.data?.meta && (
          <div className="mt-4">
            <Pagination page={page} pageSize={transmittalsQuery.data.meta.perPage} total={transmittalsQuery.data.meta.total} onPageChange={setPage} />
          </div>
        )}
      </div>

      <TransmittalFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
      <TransmittalDetailModal open={Boolean(selected)} onClose={() => setSelectedId(null)} projectId={projectId} transmittal={selected} />
    </>
  );
}
