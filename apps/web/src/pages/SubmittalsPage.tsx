import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { SubmittalFormModal } from '../components/SubmittalFormModal';
import { SubmittalDetailModal } from '../components/SubmittalDetailModal';
import { listSubmittals, getSubmittalSummary, bulkDeleteSubmittals, type SubmittalListItem } from '../lib/submittals.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  SUBMITTAL_STATUSES, SUBMITTAL_STATUS_LABELS, SUBMITTAL_STATUS_BADGE_CLASS,
  SUBMITTAL_PRIORITY_LABELS, SUBMITTAL_PRIORITY_BADGE_CLASS,
  isSubmittalOverdue, formatDate,
} from '../lib/submittal-constants';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from '../components/ui/Listbox';

export default function SubmittalsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<SubmittalListItem | null>(null);
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
    queryKey: ['submittal-summary', projectId],
    queryFn: () => getSubmittalSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const submittalsQuery = useQuery({
    queryKey: ['submittals', projectId, status],
    queryFn: () => listSubmittals(projectId!, { perPage: 100, status: status || undefined }),
    enabled: Boolean(projectId),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteSubmittals(projectId!, [...selectedIds]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submittals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['submittal-summary', projectId] });
      setSelectedIds(new Set());
    },
  });

  if (!projectId) return null;

  const submittalRows = submittalsQuery.data?.data ?? [];
  const allSelected = submittalRows.length > 0 && selectedIds.size === submittalRows.length;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Submittals"
        actions={
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + New submittal
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Listbox aria-label="Status" className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {SUBMITTAL_STATUSES.map((s) => (
              <option key={s} value={s}>{SUBMITTAL_STATUS_LABELS[s]}</option>
            ))}
          </Listbox>

          {summaryQuery.data && (
            <div className="flex gap-4 text-xs tabular-nums text-ink-500 ml-auto">
              <span>{summaryQuery.data.total} total</span>
              <span>{summaryQuery.data.pending} pending</span>
              <span className={summaryQuery.data.overdue > 0 ? 'text-danger' : ''}>{summaryQuery.data.overdue} overdue</span>
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 tick-frame panel px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <button
              onClick={() => { if (confirm(`Delete ${selectedIds.size} submittal(s)? This cannot be undone.`)) bulkDeleteMutation.mutate(); }}
              disabled={bulkDeleteMutation.isPending}
              className="btn-danger !px-4 !py-2 text-sm ml-auto"
            >
              {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
            </button>
            {bulkDeleteMutation.isError && <span className="text-xs text-danger">{apiErrorMessage(bulkDeleteMutation.error)}</span>}
          </div>
        )}

        {submittalsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {submittalsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No submittals yet. Log a shop drawing or product data submission for review.
          </div>
        )}

        {(submittalsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-x-auto" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2 font-medium w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelectedIds(allSelected ? new Set() : new Set(submittalRows.map((s) => s.id)))}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Spec</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Reviewer</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {submittalRows.map((s) => {
                  const overdue = isSubmittalOverdue(s.dueDate, s.status);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className="border-b border-base-700/60 last:border-0 hover:bg-base-700 cursor-pointer"
                    >
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                            return next;
                          })}
                        />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-500">{s.submittalNumber ?? '—'}</td>
                      <td className="px-4 py-2">{s.title}</td>
                      <td className="px-4 py-2 text-ink-300">{s.specSection ?? '—'}</td>
                      <td className="px-4 py-2"><span className={`badge ${SUBMITTAL_STATUS_BADGE_CLASS[s.status]}`}>{SUBMITTAL_STATUS_LABELS[s.status]}</span></td>
                      <td className="px-4 py-2"><span className={`badge ${SUBMITTAL_PRIORITY_BADGE_CLASS[s.priority]}`}>{SUBMITTAL_PRIORITY_LABELS[s.priority]}</span></td>
                      <td className="px-4 py-2 text-ink-300">{s.assignedToName ?? 'Unassigned'}</td>
                      <td className={`px-4 py-2 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(s.dueDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SubmittalFormModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} members={membersQuery.data ?? []} />
      <SubmittalDetailModal open={Boolean(selected)} onClose={() => setSelected(null)} projectId={projectId} submittal={selected} />
    </>
  );
}
