export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVER_JOB_NAME = 'deliver';

export interface WebhookDeliveryJobData {
  companyId: string;
  deliveryId: string;
}
