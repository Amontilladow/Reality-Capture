import type { AuthenticatedUser, AuthTokens, CompanyRole } from '@engineeringos/types';
import { apiPost, apiGet } from './api';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  tokens: AuthTokens;
  user: AuthenticatedUser;
}

export function login(payload: LoginPayload) {
  return apiPost<LoginResult>('/auth/login', payload);
}

export function logout(refreshToken: string) {
  return apiPost<void>('/auth/logout', { refreshToken });
}

export function fetchMe() {
  return apiGet<AuthenticatedUser & { requestedCompanyRole?: CompanyRole }>('/auth/me');
}

export interface AcceptInvitationPayload {
  token: string;
  firstName: string;
  lastName: string;
  password: string;
  requestedRole: CompanyRole;
}

export function acceptInvitation(payload: AcceptInvitationPayload) {
  return apiPost<LoginResult>('/auth/accept-invitation', payload);
}

export function forgotPassword(email: string) {
  return apiPost<{ message: string }>('/auth/forgot-password', { email });
}

export function resetPassword(payload: { token: string; newPassword: string }) {
  return apiPost<{ message: string }>('/auth/reset-password', payload);
}
