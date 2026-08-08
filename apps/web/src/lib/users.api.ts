import { apiGetWithMeta, apiPost } from './api';

export interface CompanyUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  companyRole: string;
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

export function inviteUser(payload: { email: string; companyRole: string; message?: string }) {
  return apiPost<InviteResult>('/users/invite', payload);
}
