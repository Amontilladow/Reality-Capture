// The fixed set of events F3 delivers. Kept as one module-local constant
// (not in @engineeringos/types) so this module stays the single place that
// knows what webhooks exist -- emitters (issues.service.ts, the capture
// image-processing processor) reference these literals directly.
export const WEBHOOK_EVENT_TYPES = ['issue.created', 'issue.status_changed', 'capture.uploaded'] as const;
export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];
