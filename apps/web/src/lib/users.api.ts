import { apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export interface CompanyUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  companyRole: string;
  // Set while the account is self-registered and awaiting admin approval;
  // absent/undefined once resolved.
  requestedCompanyRole?: string;
  // The external firm this person actually works for (e.g. "AECOM"),
  // captured at self-signup. Absent for invite-based accounts.
  organizationName?: string;
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

// Soft delete -- sets is_active = false and revokes sessions server-side.
// Also frees the seat: subscription seat counting only counts is_active users.
export function deactivateUser(userId: string) {
  return apiDelete<void>(`/users/${userId}`);
}

export interface AdminResetPasswordResult {
  // Same token mechanism as the self-service "Forgot password" email --
  // delivery is just manual here (copy and send however actually reaches
  // this person: WhatsApp, in person, printed on-site), the same fallback
  // the invite flow above already uses for invitationToken.
  resetLink: string;
  expiresAt: string;
}

export function adminResetPassword(userId: string) {
  return apiPost<AdminResetPasswordResult>(`/users/${userId}/admin-reset-password`);
}

// Phase 4F onboarding: reuses the same self-profile-edit endpoint and
// authorization path as everything else here -- "editing your own profile
// is always allowed" already covers this, so no new permission is needed.
export function setOnboardingCompleted(userId: string, completed: boolean) {
  return apiPatch<{ onboardingCompleted: boolean }>(`/users/${userId}`, { onboardingCompleted: completed });
}
