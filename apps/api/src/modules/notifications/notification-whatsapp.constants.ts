export const NOTIFICATION_WHATSAPP_QUEUE = 'notification-whatsapp';
export const NOTIFICATION_WHATSAPP_JOB_NAME = 'deliver';

export interface NotificationWhatsAppJobData {
  companyId: string;
  deliveryId: string;
}
