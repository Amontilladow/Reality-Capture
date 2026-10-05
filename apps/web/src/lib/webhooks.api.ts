import { apiGet, apiPost, apiPatch, apiDelete } from './api';

export const WEBHOOK_EVENT_TYPES = ['issue.created', 'issue.status_changed', 'capture.uploaded'] as const;

export interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  lastAttemptedAt?: string;
  lastResponseStatus?: number;
  lastError?: string;
  createdAt: string;
}

export function listWebhookEndpoints() {
  return apiGet<WebhookEndpoint[]>('/webhooks');
}

export function createWebhookEndpoint(url: string, eventTypes: string[]) {
  return apiPost<WebhookEndpoint & { secret: string }>('/webhooks', { url, eventTypes });
}

export function rotateWebhookSecret(endpointId: string) {
  return apiPost<{ id: string; secret: string }>(`/webhooks/${endpointId}/rotate-secret`);
}

export function setWebhookActive(endpointId: string, isActive: boolean) {
  return apiPatch<WebhookEndpoint>(`/webhooks/${endpointId}`, { isActive });
}

export function deleteWebhookEndpoint(endpointId: string) {
  return apiDelete<{ message: string }>(`/webhooks/${endpointId}`);
}

export function listWebhookDeliveries(endpointId: string) {
  return apiGet<WebhookDelivery[]>(`/webhooks/${endpointId}/deliveries`);
}
