import { apiGet, apiGetWithMeta, apiPatch } from './api';

export const NOTIFICATION_CATEGORIES = [
  'drawing', 'issue', 'ncr', 'sor', 'rfi', 'submittal', 'assignment', 'approval', 'deadline', 'announcement',
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

export const NOTIFICATION_PRIORITIES = ['normal', 'high', 'critical'] as const;
export type NotificationPriority = typeof NOTIFICATION_PRIORITIES[number];

export interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  projectId?: string;
  readAt?: string;
  createdAt: string;
  category?: NotificationCategory;
  priority: NotificationPriority;
  actionRequired: boolean;
  acknowledgedAt?: string;
}

export function listNotifications(query?: { perPage?: number; page?: number; unreadOnly?: boolean; category?: string; search?: string }) {
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

// Distinct from markNotificationRead -- a human confirming they will act on
// an action-required notification, not just that they saw it.
export function acknowledgeNotification(id: string) {
  return apiPatch<Notification>(`/notifications/${id}/acknowledge`, {});
}

export function lookupIssueProject(issueId: string) {
  return apiGet<{ id: string; projectId: string; issueNumber: string }>(`/issues/${issueId}`);
}
