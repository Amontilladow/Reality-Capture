import { apiGetWithMeta } from './api';

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
