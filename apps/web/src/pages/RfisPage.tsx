import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { RfiFormModal } from '../components/RfiFormModal';
import { RfiDetailModal } from '../components/RfiDetailModal';
import { listRfis, getRfiSummary, type RfiListItem } from '../lib/rfis.api';
import { getProject, getMembers } from '../lib/projects.api';
import { RFI_STATUS_LABELS, RFI_STATUS_BADGE_CLASS, RFI_PRIORITY_LABELS, RFI_PRIORITY_BADGE_CLASS, isRfiOverdue, formatDate } from '../lib/rfi-constants';

export default function RfisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<RfiListItem | null>(null);

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
    queryKey: ['rfi-summary', projectId],
    queryFn: () => getRfiSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const rfisQuery = useQuery({
    queryKey: ['rfis', projectId, status],
    queryFn: () => listRfis(projectId!, { perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="RFIs"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + New RFI
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {(['open', 'answered', 'closed', 'void'] as const).map((s) => (
              <option key={s} value={s}>{RFI_STATUS_LABELS[s]}</option>
            ))}
          </select>

          {summaryQuery.data && (
            <div className="flex gap-2 text-[10px] font-mono text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>·</span>
              <span>{summaryQuery.data.open} open</span>
              <span>·</span>
              <span className={summaryQuery.data.overdue > 0 ? 'text-danger' : ''}>{summaryQuery.data.overdue} overdue</span>
            </div>
          )}
        </div>

        {rfisQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {rfisQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No RFIs yet. Raise one to ask a formal question that needs a documented answer.
          </div>
        )}

        {(rfisQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {(rfisQuery.data?.data ?? []).map((r) => {
                  const overdue = isRfiOverdue(r.dueDate, r.status);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{r.rfiNumber ?? '—'}</td>
                      <td className="px-4 py-2.5">{r.subject}</td>
                      <td className="px-4 py-2.5"><span className={`badge ${RFI_STATUS_BADGE_CLASS[r.status]}`}>{RFI_STATUS_LABELS[r.status]}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge ${RFI_PRIORITY_BADGE_CLASS[r.priority]}`}>{RFI_PRIORITY_LABELS[r.priority]}</span></td>
                      <td className="px-4 py-2.5 text-ink-300">{r.assignedToName ?? 'Unassigned'}</td>
                      <td className={`px-4 py-2.5 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(r.dueDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RfiFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
      <RfiDetailModal open={Boolean(selected)} onClose={() => setSelected(null)} projectId={projectId} rfi={selected} />
    </>
  );
}
