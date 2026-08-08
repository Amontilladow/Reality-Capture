import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_ROLES, type ProjectRole } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { getMembers, addMember, removeMember } from '../lib/projects.api';
import { listUsers } from '../lib/users.api';
import { apiErrorMessage } from '../lib/api';

const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  project_lead: 'Project Lead',
  site_engineer: 'Site Engineer',
  surveyor: 'Surveyor',
  document_controller: 'Document Controller',
  capture_operator: 'Capture Operator',
  viewer: 'Viewer',
};

export function ManageMembersModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('site_engineer');

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId),
    enabled: open,
  });

  // Company-wide user directory, not just this project -- addMember() picks
  // from users who aren't members of this specific project yet.
  const usersQuery = useQuery({
    queryKey: ['companyUsers'],
    queryFn: () => listUsers(),
    enabled: open,
  });

  const memberIds = new Set((membersQuery.data ?? []).map((m) => m.userId));
  const addableUsers = (usersQuery.data?.data ?? []).filter((u) => !memberIds.has(u.id));

  const addMutation = useMutation({
    mutationFn: (vars: { userId: string; role: ProjectRole }) => addMember(projectId, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', projectId] });
      setSelectedUserId('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(projectId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', projectId] }),
  });

  return (
    <Modal open={open} onClose={onClose} title="Project team">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="field-label">Current members</div>
          {membersQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}
          {membersQuery.data?.length === 0 && (
            <div className="text-sm text-ink-500">No one's been added to this project yet.</div>
          )}
          {(membersQuery.data ?? []).map((m) => (
            <div key={m.userId} className="flex items-center justify-between text-sm py-1.5 border-b border-base-700/60 last:border-0">
              <div>
                <span className="text-ink-100">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</span>
                <span className="text-ink-500 ml-2 text-xs">{PROJECT_ROLE_LABELS[m.projectRole as ProjectRole] ?? m.projectRole}</span>
              </div>
              <button
                onClick={() => removeMutation.mutate(m.userId)}
                className="text-xs text-danger hover:text-danger/80"
                disabled={removeMutation.isPending}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-base-600 space-y-3">
          <div className="field-label">Add a member</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <select
                className="field-input"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">Select a person…</option>
                {addableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</option>
                ))}
              </select>
              {usersQuery.isSuccess && addableUsers.length === 0 && (
                <p className="text-xs text-ink-500 mt-1">
                  Everyone in the company is already on this project — invite a new person from Users/Settings first if you need someone else.
                </p>
              )}
            </div>
            <select
              className="field-input"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ProjectRole)}
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>{PROJECT_ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {addMutation.isError && <p className="field-error">{apiErrorMessage(addMutation.error)}</p>}

          <button
            onClick={() => addMutation.mutate({ userId: selectedUserId, role: selectedRole })}
            className="btn-primary w-full"
            disabled={!selectedUserId || addMutation.isPending}
          >
            {addMutation.isPending ? 'Adding…' : 'Add to project'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
