import axios from 'axios';
import { apiGet, apiGetWithMeta, apiPost, apiDelete } from './api';
import type { EmailIntegrationStatus, EmailProvider, PaginationQuery } from '@engineeringos/types';

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

// Phase 3E: the reusable compose/send layer -- provider-agnostic from the
// caller's point of view (the connected mailbox is resolved server-side
// from `provider`, never passed as a "from" field).

export type EmailRelatedRecordType = 'rfi' | 'issue' | 'snag_item' | 'submittal';

export interface EmailAttachmentInput {
  storageKey: string;
  filename: string;
  contentType: string;
}

export interface SendEmailPayload {
  provider: EmailProvider;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  attachments?: EmailAttachmentInput[];
  relatedRecordType?: EmailRelatedRecordType;
  relatedRecordId?: string;
  idempotencyKey: string;
}

export interface EmailMessageRecord {
  id: string;
  projectId: string;
  relatedRecordType: EmailRelatedRecordType | null;
  relatedRecordId: string | null;
  initiatingUserId: string;
  initiatingUserName: string | null;
  provider: EmailProvider;
  senderEmail: string;
  recipientsTo: string[];
  recipientsCc: string[];
  recipientsBcc: string[];
  subject: string;
  providerMessageId: string | null;
  threadId: string | null;
  status: 'sent' | 'failed';
  failureReason: string | null;
  attachmentMetadata: { filename: string; sizeBytes: number; contentType: string }[];
  createdAt: string;
}

export function sendEmail(projectId: string, payload: SendEmailPayload) {
  return apiPost<EmailMessageRecord>(`/projects/${projectId}/emails`, payload);
}

function getEmailAttachmentUploadUrl(projectId: string, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/emails/attachments/upload-url`,
    { filename, sizeBytes },
  );
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then hand back just the metadata the send() call needs --
// same two-step shape as uploadRfiAttachment (rfis.api.ts).
export async function uploadEmailAttachment(projectId: string, file: File): Promise<EmailAttachmentInput> {
  const { uploadUrl, storageKey } = await getEmailAttachmentUploadUrl(projectId, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return { storageKey, filename: file.name, contentType: file.type || 'application/octet-stream' };
}

// Phase 3G: the email history / audit-trail view -- metadata only, same as
// the backend table it reads (no message body is ever returned, because
// none is ever stored).
export function listEmailMessages(
  projectId: string,
  filters?: PaginationQuery & { relatedRecordType?: EmailRelatedRecordType; relatedRecordId?: string },
) {
  return apiGetWithMeta<EmailMessageRecord[]>(`/projects/${projectId}/emails`, { params: filters });
}
