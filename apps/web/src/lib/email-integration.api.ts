import { apiGet, apiPost, apiDelete } from './api';
import type { EmailIntegrationStatus } from '@engineeringos/types';

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

// Phase 3D: identical shape to the Outlook functions above, against
// /email-integration/gmail instead.

export function getGmailStatus() {
  return apiGet<EmailIntegrationStatus>('/email-integration/gmail/status');
}

export function getGmailAuthorizeUrl() {
  return apiGet<{ url: string }>('/email-integration/gmail/authorize-url');
}

export function testGmailConnection() {
  return apiPost<{ ok: boolean; error?: string }>('/email-integration/gmail/test');
}

export function disconnectGmail() {
  return apiDelete<{ disconnected: true }>('/email-integration/gmail');
}
