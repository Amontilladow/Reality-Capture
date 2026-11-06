import { apiGet, apiGetWithMeta, apiPatch } from './api';

export const NOTIFICATION_CATEGORIES = [
  'drawing', 'issue', 'ncr', 'sor', 'rfi', 'submittal', 'assignment', 'approval', 'deadline', 'announcement', 'escalation',
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

// Phase 4: per-user email/WhatsApp channel preferences, stored server-side
// on the user's own profile (no company-wide default to fetch separately).
export interface NotificationPreferences {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  mutedCategories: NotificationCategory[];
}

export function getNotificationPreferences() {
  return apiGet<NotificationPreferences>('/notifications/preferences');
}

export function updateNotificationPreferences(patch: Partial<NotificationPreferences>) {
  return apiPatch<NotificationPreferences>('/notifications/preferences', patch);
}

// Phase 4 admin console: delivery logs, company_admin only (the backend
// 403s for anyone else -- these calls simply aren't surfaced in the UI
// for a non-admin).
export interface EmailDelivery {
  id: string;
  toEmail: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptedAt?: string;
  lastError?: string;
  createdAt: string;
  notificationType: string;
  notificationTitle: string;
}

export interface WhatsAppDelivery {
  id: string;
  toPhone: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped_not_configured';
  providerMessageId?: string;
  attempts: number;
  lastAttemptedAt?: string;
  lastError?: string;
  createdAt: string;
  notificationType: string;
  notificationTitle: string;
}

export function listEmailDeliveries(query?: { page?: number; perPage?: number }) {
  return apiGetWithMeta<EmailDelivery[]>('/notifications/admin/email-deliveries', { params: query });
}

export function listWhatsAppDeliveries(query?: { page?: number; perPage?: number }) {
  return apiGetWithMeta<WhatsAppDelivery[]>('/notifications/admin/whatsapp-deliveries', { params: query });
}
