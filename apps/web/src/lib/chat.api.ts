import type { PaginationQuery } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPatch } from './api';

// Live floating-chat widget's REST client -- a project team channel plus
// 1-to-1 DMs, both backed by the Socket.io /chat gateway for the live
// message stream (see chat-socket.ts). This is deliberately separate from
// messaging.api.ts (the async, threaded "Messages" inbox) -- different
// feature, different backend routes, not to be merged.

export interface ChatMessage {
  id: string;
  channelType: 'project' | 'dm';
  channelId: string;
  fromUserId: string;
  // Defensive: the backend contract lists this as optional -- fall back to
  // a generic label rather than rendering "undefined" if it's ever missing.
  fromUserName?: string;
  body: string;
  createdAt: string;
}

export interface ChatDmThread {
  channelId: string;
  otherUserId: string;
  otherUserName?: string;
  lastMessageBody?: string;
  lastMessageAt?: string;
  unread: boolean;
}

// Project team channel: one channel per project, keyed by the project's own
// id as the channelId. Assumption (backend ticket landing in parallel) --
// the contract doesn't spell out what channelId a project channel uses, but
// the REST route is scoped by :projectId and the WS side needs a channelId
// to join/send on, so the project id is the only value both sides already
// have in common.
export function listProjectChatMessages(projectId: string, query?: PaginationQuery) {
  return apiGetWithMeta<ChatMessage[]>(`/projects/${projectId}/chat/messages`, { params: query });
}

export function listDmThreads() {
  return apiGet<ChatDmThread[]>('/chat/dm/threads');
}

// Also used to start a brand-new DM: passing a otherUserId with no existing
// thread is expected to lazily create/return the channel (with an empty
// `messages` array) rather than erroring.
export function listDmMessages(otherUserId: string, query?: PaginationQuery) {
  return apiGetWithMeta<{ channelId: string; messages: ChatMessage[] }>(
    `/chat/dm/${otherUserId}/messages`,
    { params: query },
  );
}

export function markChatRead(payload: { channelType: 'project' | 'dm'; channelId: string }) {
  return apiPatch<{ ok?: boolean }>('/chat/read', payload);
}

export function getChatUnreadCount() {
  return apiGet<{ count: number }>('/chat/unread-count');
}
