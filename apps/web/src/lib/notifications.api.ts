import { apiGet, apiGetWithMeta, apiPatch } from './api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  readAt?: string;
  createdAt: string;
}

export function listNotifications(query?: { perPage?: number; unreadOnly?: boolean }) {
  return apiGetWithMeta<Notification[]>('/notifications', { params: query });
}

export function getUnreadCount() {
  return apiGet<{ count: number }>('/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return apiPatch<Notification>(`/notifications/${id}/read`, {});
}

export function markAllNotificationsRead() {
  return apiPatch<{ updated: number }>('/notifications/read-all', {});
}

export function lookupIssueProject(issueId: string) {
  return apiGet<{ id: string; projectId: string; issueNumber: string }>(`/issues/${issueId}`);
}
