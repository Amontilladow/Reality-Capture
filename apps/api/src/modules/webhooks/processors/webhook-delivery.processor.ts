import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { DatabaseService } from '../../../database/database.service';
import type { WebhookDeliveryJobData } from '../webhook-delivery.constants';

const DELIVERY_TIMEOUT_MS = 10_000;

// Runs in a separate Bull worker, same pattern as ImageProcessingProcessor --
// never blocks the API request (issue create/status-change, capture
// processing) that triggered the event. Every attempt updates the
// webhook_deliveries row (attempts/last_attempted_at/last_response_status/
// last_error, status 'delivered' or 'failed') independently of Bull's own
// retry bookkeeping, then re-throws on failure so Bull retries with the
// exponential backoff configured in webhooks.module.ts -- identical
// "update status, then re-throw" shape to image-processing.processor.ts's
// catch block.
@Processor('webhook-delivery')
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(private readonly db: DatabaseService) {}

  @Process('deliver')
  async handleDeliver(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { companyId, deliveryId } = job.data;

    const [delivery] = await this.db.withTenant(companyId, sql => sql`
      SELECT d.id, d.event_type, d.payload, e.url, e.secret
      FROM webhook_deliveries d
      JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id
      WHERE d.id = ${deliveryId} AND d.company_id = ${companyId}
    `);
    if (!delivery) {
      this.logger.warn(`Webhook delivery ${deliveryId} not found (endpoint deleted?) -- skipping.`);
      return;
    }

    const body = JSON.stringify({ event: delivery.eventType, data: delivery.payload });
    const signature = createHmac('sha256', delivery.secret as string).update(body).digest('hex');

    let response: Response;
    try {
      response = await fetch(delivery.url as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': delivery.eventType as string,
          'X-Webhook-Delivery': deliveryId,
          'X-Webhook-Signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown delivery error';
      // withTenant required -- webhook_deliveries carries the tenant_isolation RLS policy.
      await this.db.withTenant(companyId, sql => sql`
        UPDATE webhook_deliveries SET
          attempts = attempts + 1, last_attempted_at = NOW(), status = 'failed', last_error = ${message}
        WHERE id = ${deliveryId} AND company_id = ${companyId}
      `);
      this.logger.warn(`Webhook delivery ${deliveryId} failed to reach endpoint: ${message}`);
      throw error; // Re-throw so Bull retries the job
    }

    // withTenant required -- see the UPDATE above.
    await this.db.withTenant(companyId, sql => sql`
      UPDATE webhook_deliveries SET
        attempts = attempts + 1, last_attempted_at = NOW(),
        last_response_status = ${response.status},
        status = ${response.ok ? 'delivered' : 'failed'},
        last_error = ${response.ok ? null : `HTTP ${response.status}`}
      WHERE id = ${deliveryId} AND company_id = ${companyId}
    `);

    if (!response.ok) {
      this.logger.warn(`Webhook delivery ${deliveryId} failed: HTTP ${response.status}`);
      throw new Error(`Webhook endpoint responded ${response.status}`); // Re-throw so Bull retries the job
    }
  }
}
