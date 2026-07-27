import { apiPost, apiGet, apiPatch } from './api';
import type { AuthenticatedUser } from '@engineeringos/types';

export interface RegisterCompanyPayload {
  companyName: string;
  slug: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  adminPassword: string;
}

export function registerCompany(payload: RegisterCompanyPayload) {
  return apiPost<{ company: unknown; user: AuthenticatedUser }>('/company/register', payload);
}

export function fetchCompany() {
  return apiGet<Record<string, unknown>>('/company');
}

export function updateCompanySettings(settings: Record<string, unknown>) {
  return apiPatch<Record<string, unknown>>('/company/settings', settings);
}
