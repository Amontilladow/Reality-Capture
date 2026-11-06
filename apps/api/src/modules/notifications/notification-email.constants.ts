export const NOTIFICATION_EMAIL_QUEUE = 'notification-email';
export const NOTIFICATION_EMAIL_JOB_NAME = 'deliver';

export interface NotificationEmailJobData {
  companyId: string;
  deliveryId: string;
}
