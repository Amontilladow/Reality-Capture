import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { TransmittalFormModal } from '../components/TransmittalFormModal';
import { TransmittalDetailModal } from '../components/TransmittalDetailModal';
import { listTransmittals, getTransmittalSummary } from '../lib/transmittals.api';
import { getProject } from '../lib/projects.api';
import {
  TRANSMITTAL_STATUSES, TRANSMITTAL_STATUS_LABELS, TRANSMITTAL_STATUS_BADGE_CLASS,
  TRANSMITTAL_PURPOSE_LABELS, formatDate,
} from '../lib/transmittal-constants';

export default function TransmittalsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const transmittalsQuery = useQuery({
    queryKey: ['transmittals', projectId, status],
    queryFn: () => listTransmittals(projectId!, { perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  // Derived from the live query result (not a click-time snapshot) so the
  // detail modal reflects a status change immediately instead of showing
  // stale data until it's closed and reopened.
  const selected = selectedId ? (transmittalsQuery.data?.data ?? []).find((t) => t.id === selectedId) ?? null : null;

  if (!projectId) return null;

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
        <div className="flex items-center gap-3 flex-wrap">
          <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TRANSMITTAL_STATUSES.map((s) => (
              <option key={s} value={s}>{TRANSMITTAL_STATUS_LABELS[s]}</option>
            ))}
          </select>

          {summaryQuery.data && (
            <div className="flex gap-2 text-[10px] font-mono text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>·</span>
              <span>{summaryQuery.data.draft} draft</span>
              <span>·</span>
              <span>{summaryQuery.data.sent} sent</span>
              <span>·</span>
              <span>{summaryQuery.data.acknowledged} acknowledged</span>
            </div>
          )}
        </div>

        {transmittalsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {transmittalsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No transmittals yet. Log a set of drawings or documents being sent out.
          </div>
        )}

        {(transmittalsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">Recipient</th>
                  <th className="px-4 py-2.5 font-medium">Purpose</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody>
                {(transmittalsQuery.data?.data ?? []).map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{t.transmittalNumber ?? '—'}</td>
                    <td className="px-4 py-2.5">{t.subject}</td>
                    <td className="px-4 py-2.5 text-ink-300">{t.recipientName}{t.recipientCompany ? ` (${t.recipientCompany})` : ''}</td>
                    <td className="px-4 py-2.5 text-ink-300">{TRANSMITTAL_PURPOSE_LABELS[t.purpose]}</td>
                    <td className="px-4 py-2.5"><span className={`badge ${TRANSMITTAL_STATUS_BADGE_CLASS[t.status]}`}>{TRANSMITTAL_STATUS_LABELS[t.status]}</span></td>
                    <td className="px-4 py-2.5 text-ink-300">{formatDate(t.sentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TransmittalFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
      <TransmittalDetailModal open={Boolean(selected)} onClose={() => setSelectedId(null)} projectId={projectId} transmittal={selected} />
    </>
  );
}
