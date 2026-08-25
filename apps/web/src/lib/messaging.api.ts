import { apiGet, apiGetWithMeta, apiPatch, apiPost } from './api';

export interface Message {
  id: string;
  threadId: string;
  subject: string;
  body: string;
  fromUserId: string;
  fromUserName?: string;
  projectId?: string;
  createdAt: string;
}

// Preview row for the inbox/sent list. The documented contract says the
// backend may send either a pre-truncated `bodySnippet` or the full latest
// `body` -- both are read defensively here and truncated client-side via
// `snippetOf` regardless of which one actually shows up once the backend
// ticket lands.
export interface ThreadSummary {
  threadId: string;
  subject: string;
  bodySnippet?: string;
  body?: string;
  fromUserName?: string;
  createdAt: string;
  unread: boolean;
}

export function snippetOf(t: ThreadSummary, max = 120): string {
  const text = t.bodySnippet ?? t.body ?? '';
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function listInbox(query?: { page?: number; perPage?: number }) {
  return apiGetWithMeta<ThreadSummary[]>('/messages/inbox', { params: query });
}

export function listSent(query?: { page?: number; perPage?: number }) {
  return apiGetWithMeta<ThreadSummary[]>('/messages/sent', { params: query });
}

export function getThread(threadId: string) {
  return apiGet<Message[]>(`/messages/thread/${threadId}`);
}

export function sendMessage(payload: {
  subject: string;
  body: string;
  recipientUserIds: string[];
  projectId?: string;
}) {
  return apiPost<Message>('/messages', payload);
}

// ASSUMPTION: the documented contract's `:id` segment on the reply and read
// routes is the thread id. ThreadSummary rows (what the inbox list and the
// bell dropdown preview have on hand) only expose `threadId`, not a specific
// message id, so this client keys both actions off threadId consistently.
// Revisit once the parallel backend ticket lands, if it turns out `:id`
// actually expects a specific message id instead.
export function replyToThread(threadId: string, body: string) {
  return apiPost<Message>(`/messages/${threadId}/reply`, { body });
}

export function markThreadRead(threadId: string) {
  return apiPatch<unknown>(`/messages/${threadId}/read`, {});
}

export function getUnreadMessageCount() {
  return apiGet<{ count: number }>('/messages/unread-count');
}
