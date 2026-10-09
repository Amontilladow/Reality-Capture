import { apiGet, apiPost, apiDelete } from './api';
import type { EmailIntegrationStatus } from '@engineeringos/types';

// Outlook only for now (Phase 3C) -- Gmail's equivalent functions land in
// Phase 3D under the same /email-integration/gmail base path, following
// the identical shape.

export function getOutlookStatus() {
  return apiGet<EmailIntegrationStatus>('/email-integration/outlook/status');
}

export function getOutlookAuthorizeUrl() {
  return apiGet<{ url: string }>('/email-integration/outlook/authorize-url');
}

export function testOutlookConnection() {
  return apiPost<{ ok: boolean; error?: string }>('/email-integration/outlook/test');
}

export function disconnectOutlook() {
  return apiDelete<{ disconnected: true }>('/email-integration/outlook');
}
