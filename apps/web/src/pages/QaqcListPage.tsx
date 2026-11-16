import { useState } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { QaqcFormModal } from '../components/QaqcFormModal';
import { listQaqcRecords, bulkDeleteQaqcRecords, type QaqcRecordType } from '../lib/qaqc.api';
import { getProject, getMembers } from '../lib/projects.api';
import {
  QAQC_PRIORITIES, QAQC_PRIORITY_LABELS, QAQC_STATUS_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS,
  isQaqcOverdue, formatDate, QAQC_ISSUE_ROLES_BY_TYPE, QAQC_STATUS_TONE, QAQC_PRIORITY_TONE,
} from '../lib/qaqc-constants';
import { StatusBadge } from '../components/ui/Badge';
import { apiErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { Listbox } from '../components/ui/Listbox';

// One shared list implementation for all four record types, parameterized
// by the :recordType path segment (/projects/:projectId/qaqc/ncr, /sor,
// /wir, or /mir): per the brief's §3/§4, this is one implementation, not
// four forked pages.
export default function QaqcListPage() {
  const { projectId, recordType } = useParams<{ projectId: string; recordType: QaqcRecordType }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [discipline, setDiscipline] = useState('');
  // ?new=1 (the Overview's quick actions) opens the form straight away.
  const [newParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(newParams.get('new') === '1');
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

  const recordsQuery = useQuery({
    queryKey: ['qaqc-records', projectId, recordType, status, priority, discipline],
    queryFn: () => listQaqcRecords(projectId!, {
      recordType,
      perPage: 100,
      status: status || undefined,
      priority: priority || undefined,
      discipline: discipline || undefined,
    }),
    enabled: Boolean(projectId && recordType),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteQaqcRecords(projectId!, [...selectedIds]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qaqc-records', projectId, recordType] });
      setSelectedIds(new Set());
    },
  });

  if (!projectId || !recordType) return null;

  const shortLabel = QAQC_RECORD_TYPE_SHORT_LABELS[recordType];
  // Mirrors the backend's DELETE_ROLES (qaqc.controller.ts): only an admin
  // can delete records, unlike the issue/respond/confirm workflow.
  const canDelete = currentUser?.companyRole === 'company_admin' || currentUser?.companyRole === 'super_admin';
  const recordRows = recordsQuery.data?.data ?? [];
  const allSelected = recordRows.length > 0 && selectedIds.size === recordRows.length;

  // Client-side visual gating only: QaqcService's per-type role check is
  // the real enforcement (see qaqc.service.ts's ISSUE_ROLES_BY_TYPE). Hides
  // (not just disables) the create action for anyone outside this specific
  // record type's issuer role set; NCR/SOR issued by QAQC-in-charge,
  // WIR/MIR issued by the construction team (roles swapped per type).
  const canCreate = Boolean(currentUser?.companyRole && QAQC_ISSUE_ROLES_BY_TYPE[recordType].includes(currentUser.companyRole));

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title={shortLabel}
        actions={
          <>
            <Link to={`/projects/${projectId}/qaqc`} className="btn-ghost !px-2 !py-2 ">
              Back to QAQC
            </Link>
            {canCreate && (
              <button onClick={() => setCreateOpen(true)} className="btn-primary">
                + New {shortLabel}
              </button>
            )}
          </>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Listbox aria-label="Status" className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {(['open', 'pending_confirmation', 'closed', 'reopened'] as const).map((s) => (
              <option key={s} value={s}>{QAQC_STATUS_LABELS[s]}</option>
            ))}
          </Listbox>

          <Listbox aria-label="Priority" className="field-input w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {QAQC_PRIORITIES.map((p) => (
              <option key={p} value={p}>{QAQC_PRIORITY_LABELS[p]}</option>
            ))}
          </Listbox>

          <Listbox aria-label="Discipline" className="field-input w-auto" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option value="">All disciplines</option>
            {RFI_DISCIPLINES.map((d) => (
              <option key={d} value={d}>{RFI_DISCIPLINE_LABELS[d]}</option>
            ))}
          </Listbox>
        </div>

        {canDelete && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 tick-frame panel px-4 py-3">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <button
              onClick={() => { if (confirm(`Delete ${selectedIds.size} ${shortLabel}(s)? This cannot be undone.`)) bulkDeleteMutation.mutate(); }}
              disabled={bulkDeleteMutation.isPending}
              className="btn-danger !px-3 !py-1.5 text-sm ml-auto"
            >
              {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
            </button>
            {bulkDeleteMutation.isError && <span className="text-xs text-danger">{apiErrorMessage(bulkDeleteMutation.error)}</span>}
          </div>
        )}

        {recordsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {recordsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No {shortLabel}s yet.
          </div>
        )}

        {(recordsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-x-auto" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  {canDelete && (
                    <th className="px-4 py-2 font-medium w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setSelectedIds(allSelected ? new Set() : new Set(recordRows.map((r) => r.id)))}
                      />
                    </th>
                  )}
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Discipline</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Assignee</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {recordRows.map((r) => {
                  const overdue = isQaqcOverdue(r.dueDate, r.status);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/projects/${projectId}/qaqc/${recordType}/${r.id}`)}
                      className="border-b border-base-700/60 last:border-0 hover:bg-base-700 cursor-pointer"
                    >
                      {canDelete && (
                        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                              return next;
                            })}
                          />
                        </td>
                      )}
                      <td className="px-4 py-2 font-mono text-xs text-ink-500">{r.recordNumber ?? '—'}</td>
                      <td className="px-4 py-2">{r.subject}</td>
                      <td className="px-4 py-2 text-ink-300">{r.discipline ? RFI_DISCIPLINE_LABELS[r.discipline] : '—'}</td>
                      <td className="px-4 py-2"><StatusBadge tone={QAQC_STATUS_TONE[r.status]} label={QAQC_STATUS_LABELS[r.status]} /></td>
                      <td className="px-4 py-2"><StatusBadge tone={QAQC_PRIORITY_TONE[r.priority]} label={QAQC_PRIORITY_LABELS[r.priority]} /></td>
                      <td className="px-4 py-2 text-ink-300">{r.assignedToName ?? 'Unassigned'}</td>
                      <td className={`px-4 py-2 ${overdue ? 'text-danger' : 'text-ink-300'}`}>{formatDate(r.dueDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <QaqcFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        recordType={recordType}
        members={membersQuery.data ?? []}
      />
    </>
  );
}
