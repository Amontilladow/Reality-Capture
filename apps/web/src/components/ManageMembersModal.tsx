import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_ROLES, COMPANY_ROLES, type ProjectRole, type CompanyRole } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { getMembers, addMember, removeMember } from '../lib/projects.api';
import { listUsers, inviteUser } from '../lib/users.api';
import { apiErrorMessage } from '../lib/api';

const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  project_lead: 'Project Lead',
  site_engineer: 'Site Engineer',
  surveyor: 'Surveyor',
  document_controller: 'Document Controller',
  capture_operator: 'Capture Operator',
  viewer: 'Viewer',
};

const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  super_admin: 'Super Admin',
  company_admin: 'Company Admin',
  technical_director: 'Technical Director',
  engineering_manager: 'Engineering Manager',
  bim_manager: 'BIM Manager',
  project_manager: 'Project Manager',
  construction_manager: 'Construction Manager',
  qa_qc_manager: 'QA/QC Manager',
  commercial_manager: 'Commercial Manager',
  consultant: 'Consultant',
  client_representative: 'Client Representative',
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
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CompanyRole>('consultant');

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

  const inviteMutation = useMutation({
    mutationFn: (vars: { email: string; companyRole: CompanyRole }) => inviteUser(vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companyUsers'] }),
  });

  const inviteLink = inviteMutation.data
    ? `${window.location.origin}/accept-invitation?token=${inviteMutation.data.invitationToken}`
    : null;

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
                  Everyone in the company is already on this project — invite a new person below if you need someone else.
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

        <div className="pt-2 border-t border-base-600 space-y-3">
          {!showInvite ? (
            <button onClick={() => setShowInvite(true)} className="text-sm text-blueprint hover:text-blueprint-hover">
              + Invite someone new to the company
            </button>
          ) : (
            <>
              <div className="field-label">Invite a new person</div>
              <p className="text-xs text-ink-500">
                Email delivery isn't set up yet -- inviting someone gives you a link to copy and send them yourself (WhatsApp, email, however). It won't land in their inbox automatically.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="email"
                  className="field-input"
                  placeholder="their.email@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <select
                  className="field-input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as CompanyRole)}
                >
                  {COMPANY_ROLES.filter((r) => r !== 'super_admin').map((r) => (
                    <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>

              {inviteMutation.isError && <p className="field-error">{apiErrorMessage(inviteMutation.error)}</p>}

              {inviteLink ? (
                <div className="space-y-2">
                  <p className="text-xs text-ink-100">
                    Invite created for {inviteMutation.data?.email}. Send them this link -- it expires in 7 days:
                  </p>
                  <div className="flex gap-2">
                    <input readOnly className="field-input font-mono text-xs" value={inviteLink} onClick={(e) => e.currentTarget.select()} />
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteLink)}
                      className="btn-secondary shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => inviteMutation.mutate({ email: inviteEmail, companyRole: inviteRole })}
                  className="btn-primary w-full"
                  disabled={!inviteEmail || inviteMutation.isPending}
                >
                  {inviteMutation.isPending ? 'Creating invite…' : 'Create invite link'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
