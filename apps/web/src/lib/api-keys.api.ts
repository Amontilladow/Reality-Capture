import { apiGet, apiPost, apiDelete } from './api';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string;
  revokedAt?: string;
  createdBy: string;
  createdAt: string;
}

export function listApiKeys() {
  return apiGet<ApiKey[]>('/api-keys');
}

export function createApiKey(name: string) {
  return apiPost<ApiKey & { apiKey: string }>('/api-keys', { name });
}

export function revokeApiKey(keyId: string) {
  return apiDelete<{ message: string }>(`/api-keys/${keyId}`);
}
