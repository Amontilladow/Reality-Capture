import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { SnagItemFormModal } from '../components/SnagItemFormModal';
import { SnagItemDetailModal } from '../components/SnagItemDetailModal';
import { listSnagItems, getSnagSummary } from '../lib/snagging.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  SNAG_STATUSES, SNAG_STATUS_LABELS, SNAG_STATUS_BADGE_CLASS,
  SNAG_PRIORITY_LABELS, SNAG_PRIORITY_BADGE_CLASS, isSnagOverdue, formatDate,
} from '../lib/snagging-constants';

export default function SnaggingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('snagId'));

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
    queryKey: ['snag-summary', projectId],
    queryFn: () => getSnagSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const snagItemsQuery = useQuery({
    queryKey: ['snag-items', projectId, status],
    queryFn: () => listSnagItems(projectId!, { perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  const selected = selectedId ? (snagItemsQuery.data?.data ?? []).find((s) => s.id === selectedId) ?? null : null;

  if (!projectId) return null;

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

        {snagItemsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No snag items yet. Log a punch-list item found during a walkthrough.
          </div>
        )}

        {(snagItemsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-hidden">
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
                {(snagItemsQuery.data?.data ?? []).map((s) => {
                  const overdue = isSnagOverdue(s.dueDate, s.status);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{s.snagNumber ?? '—'}</td>
                      <td className="px-4 py-2.5">{s.title}</td>
                      <td className="px-4 py-2.5 text-ink-300">{s.location ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-300">{s.trade ?? '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge ${SNAG_STATUS_BADGE_CLASS[s.status]}`}>{SNAG_STATUS_LABELS[s.status]}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge ${SNAG_PRIORITY_BADGE_CLASS[s.priority]}`}>{SNAG_PRIORITY_LABELS[s.priority]}</span></td>
                      <td className={`px-4 py-2.5 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(s.dueDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SnagItemFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
      <SnagItemDetailModal open={Boolean(selected)} onClose={() => setSelectedId(null)} projectId={projectId} snag={selected} />
    </>
  );
}
