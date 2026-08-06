import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { QaInspectionFormModal } from '../components/QaInspectionFormModal';
import { QaInspectionDetailModal } from '../components/QaInspectionDetailModal';
import { listInspections, getQaSummary } from '../lib/qa.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  QA_STATUSES, QA_STATUS_LABELS, QA_STATUS_BADGE_CLASS, formatDate,
} from '../lib/qa-constants';

export default function QaInspectionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const inspectionsQuery = useQuery({
    queryKey: ['qa-inspections', projectId, status],
    queryFn: () => listInspections(projectId!, { perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  // Derived from the live query result, not a click-time snapshot, so the
  // detail modal reflects a status change immediately instead of showing
  // stale data until it's closed and reopened.
  const selected = selectedId ? (inspectionsQuery.data?.data ?? []).find((i) => i.id === selectedId) ?? null : null;

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="QA/QC"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + New inspection
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {QA_STATUSES.map((s) => (
              <option key={s} value={s}>{QA_STATUS_LABELS[s]}</option>
            ))}
          </select>

          {summaryQuery.data && (
            <div className="flex gap-2 text-[10px] font-mono text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>·</span>
              <span>{summaryQuery.data.pending} pending</span>
              <span>·</span>
              <span>{summaryQuery.data.passed} passed</span>
              <span>·</span>
              <span className={summaryQuery.data.failed > 0 ? 'text-danger' : ''}>{summaryQuery.data.failed} failed</span>
            </div>
          )}
        </div>

        {inspectionsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {inspectionsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No inspections yet. Schedule a quality check against a scope of work.
          </div>
        )}

        {(inspectionsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Inspector</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {(inspectionsQuery.data?.data ?? []).map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setSelectedId(i.id)}
                    className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{i.inspectionNumber ?? '—'}</td>
                    <td className="px-4 py-2.5">{i.title}</td>
                    <td className="px-4 py-2.5 text-ink-300">{i.inspectionType ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-300">{i.location ?? '—'}</td>
                    <td className="px-4 py-2.5"><span className={`badge ${QA_STATUS_BADGE_CLASS[i.status]}`}>{QA_STATUS_LABELS[i.status]}</span></td>
                    <td className="px-4 py-2.5 text-ink-300">{i.assignedToName ?? 'Unassigned'}</td>
                    <td className="px-4 py-2.5 text-ink-300">{formatDate(i.inspectionDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <QaInspectionFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
      <QaInspectionDetailModal open={Boolean(selected)} onClose={() => setSelectedId(null)} projectId={projectId} inspection={selected} />
    </>
  );
}
