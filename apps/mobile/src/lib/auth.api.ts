import type { AuthenticatedUser, AuthTokens } from '@engineeringos/types';
import { apiPost, apiGet } from './api';

export interface LoginResult {
  tokens: AuthTokens;
  user: AuthenticatedUser;
}

export function login(email: string, password: string) {
  return apiPost<LoginResult>('/auth/login', { email, password });
}

export function logout(refreshToken: string) {
  return apiPost<void>('/auth/logout', { refreshToken });
}

export function fetchMe() {
  return apiGet<AuthenticatedUser>('/auth/me');
}
