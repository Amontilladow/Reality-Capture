import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_ROLES, COMPANY_ROLES, type ProjectRole, type CompanyRole } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { getMembers, addMember, removeMember } from '../lib/projects.api';
import { listUsers, inviteUser, approveUserRole, deactivateUser } from '../lib/users.api';
import { apiErrorMessage } from '../lib/api';
import { PROJECT_ROLE_LABELS, COMPANY_ROLE_LABELS } from '../lib/issue-constants';
import { useAuthStore } from '../store/auth.store';

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
  const currentUser = useAuthStore((s) => s.user);
  const isCompanyAdmin = currentUser?.companyRole === 'company_admin' || currentUser?.companyRole === 'super_admin';
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('site_engineer');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [overrideRole, setOverrideRole] = useState<Record<string, CompanyRole>>({});

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
    mutationFn: (vars: { email: string }) => inviteUser(vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companyUsers'] }),
  });

  const inviteLink = inviteMutation.data
    ? `${window.location.origin}/accept-invitation?token=${inviteMutation.data.invitationToken}`
    : null;

  const pendingUsers = (usersQuery.data?.data ?? []).filter((u) => u.requestedCompanyRole);

  const approveMutation = useMutation({
    mutationFn: (vars: { userId: string; companyRole: CompanyRole }) => approveUserRole(vars.userId, vars.companyRole),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companyUsers'] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyUsers'] });
      queryClient.invalidateQueries({ queryKey: ['members', projectId] });
      setSelectedUserId('');
    },
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
          {removeMutation.isError && <p className="field-error">{apiErrorMessage(removeMutation.error)}</p>}
          {(membersQuery.data ?? []).map((m) => (
            <div key={m.userId} className="flex items-center justify-between text-sm py-1.5 border-b border-base-700/60 last:border-0">
              <div>
                <span className="text-ink-100">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</span>
                <span className="text-ink-500 ml-2 text-xs">{PROJECT_ROLE_LABELS[m.role as ProjectRole] ?? m.role}</span>
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
          {deactivateMutation.isError && <p className="field-error">{apiErrorMessage(deactivateMutation.error)}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <select
                  className="field-input flex-1"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  <option value="">Select a person…</option>
                  {addableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</option>
                  ))}
                </select>
                {isCompanyAdmin && (
                  <button
                    type="button"
                    onClick={() => selectedUserId && deactivateMutation.mutate(selectedUserId)}
                    disabled={!selectedUserId || selectedUserId === currentUser?.id || deactivateMutation.isPending}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded border border-base-600 text-danger hover:bg-danger/10 disabled:opacity-30 disabled:cursor-not-allowed"
                    title={
                      !selectedUserId
                        ? 'Select a person above, then click here to remove them from the company entirely'
                        : selectedUserId === currentUser?.id
                        ? "You can't deactivate your own account."
                        : 'Remove this person from the company (deactivates their account, frees their seat)'
                    }
                    aria-label="Deactivate selected person"
                  >
                    ✕
                  </button>
                )}
              </div>
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
                They'll pick their own position when they accept, and it stays pending until you approve it below.
                Email delivery isn't set up yet -- inviting someone gives you a link to copy and send them yourself (WhatsApp, email, however). It won't land in their inbox automatically.
              </p>
              <input
                type="email"
                className="field-input"
                placeholder="their.email@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />

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
                  onClick={() => inviteMutation.mutate({ email: inviteEmail })}
                  className="btn-primary w-full"
                  disabled={!inviteEmail || inviteMutation.isPending}
                >
                  {inviteMutation.isPending ? 'Creating invite…' : 'Create invite link'}
                </button>
              )}
            </>
          )}
        </div>

        <div className="pt-2 border-t border-base-600 space-y-3">
          <div className="field-label">Pending approvals</div>
          <p className="text-xs text-ink-500">
            Company-wide, not specific to this project -- anyone who's accepted an invite but hasn't been approved yet.
          </p>
          {pendingUsers.length === 0 && (
            <p className="text-sm text-ink-500">No one's waiting on approval.</p>
          )}
          {pendingUsers.map((u) => {
            const role = overrideRole[u.id] ?? (u.requestedCompanyRole as CompanyRole);
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-base-700/60 last:border-0">
                <div>
                  <div className="text-ink-100">{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</div>
                  <div className="text-ink-500 text-xs">
                    requested: {COMPANY_ROLE_LABELS[u.requestedCompanyRole as CompanyRole] ?? u.requestedCompanyRole}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="field-input !w-auto text-xs"
                    value={role}
                    onChange={(e) => setOverrideRole((prev) => ({ ...prev, [u.id]: e.target.value as CompanyRole }))}
                  >
                    {COMPANY_ROLES.filter((r) => r !== 'super_admin').map((r) => (
                      <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => approveMutation.mutate({ userId: u.id, companyRole: role })}
                    className="btn-primary !py-1 !px-2 text-xs shrink-0"
                    disabled={approveMutation.isPending}
                  >
                    Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {isCompanyAdmin && (
          <div className="pt-2 border-t border-base-600 space-y-3">
            <div className="field-label">Company members</div>
            <p className="text-xs text-ink-500">
              Deactivating someone revokes their access company-wide (not just this project) and frees their seat.
              This includes people who were invited but never accepted -- deactivate them to cancel a stale invite.
            </p>
            {deactivateMutation.isError && <p className="field-error">{apiErrorMessage(deactivateMutation.error)}</p>}
            {(usersQuery.data?.data ?? []).map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <div key={u.id} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-base-700/60 last:border-0">
                  <div>
                    <div className="text-ink-100">{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</div>
                    <div className="text-ink-500 text-xs">
                      {u.email}
                      {!u.firstName && !u.lastName && ' — invited, hasn’t accepted yet'}
                    </div>
                  </div>
                  <button
                    onClick={() => deactivateMutation.mutate(u.id)}
                    className="text-xs text-danger hover:text-danger/80 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={deactivateMutation.isPending || isSelf}
                    title={isSelf ? "You can't deactivate your own account." : undefined}
                  >
                    Deactivate
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
