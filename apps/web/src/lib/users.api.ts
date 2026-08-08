import { apiGetWithMeta, apiPost, apiPatch } from './api';

export interface CompanyUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  companyRole: string;
  // Set while the account is self-registered and awaiting admin approval;
  // absent/undefined once resolved.
  requestedCompanyRole?: string;
}

export function listUsers() {
  return apiGetWithMeta<CompanyUser[]>('/users', { params: { perPage: 200 } });
}

export interface InviteResult {
  id: string;
  email: string;
  invitationSent: boolean;
  // Real email delivery isn't wired up yet -- this is the raw token so the
  // caller can build a shareable /accept-invitation?token=... link.
  invitationToken: string;
}

export function inviteUser(payload: { email: string; message?: string }) {
  return apiPost<InviteResult>('/users/invite', payload);
}

// Setting companyRole here doubles as approving (or overriding) a pending
// self-selected role request -- the backend clears requested_company_role
// as a side effect of this call, not a separate action.
export function approveUserRole(userId: string, companyRole: string) {
  return apiPatch<CompanyUser>(`/users/${userId}`, { companyRole });
}
