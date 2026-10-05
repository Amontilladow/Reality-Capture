import { randomBytes } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DatabaseService } from '../../database/database.service';
import { WEBHOOK_DELIVERY_QUEUE, WEBHOOK_DELIVER_JOB_NAME, type WebhookDeliveryJobData } from './webhook-delivery.constants';
import type { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import type { WebhookEventType } from './webhook-events';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly deliveryQueue: Queue<WebhookDeliveryJobData>,
  ) {}

  // ── Endpoint management (authenticated, company-admin) ───────────────────
  async create(companyId: string, userId: string, dto: CreateWebhookEndpointDto) {
    const secret = randomBytes(32).toString('hex');
    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO webhook_endpoints (company_id, url, secret, event_types, created_by)
      VALUES (${companyId}, ${dto.url}, ${secret}, ${dto.eventTypes}, ${userId})
      RETURNING id, url, event_types, is_active, created_at
    `);
    // The secret is returned once, at creation -- the receiving client must
    // store it to verify the X-Webhook-Signature header on every delivery.
    // It's never re-displayed by list(); rotate() issues a new one.
    return { ...row, secret };
  }

  async list(companyId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, url, event_types, is_active, created_by, created_at, updated_at
      FROM webhook_endpoints WHERE company_id = ${companyId} ORDER BY created_at DESC
    `);
  }

  async rotate(companyId: string, endpointId: string) {
    const secret = randomBytes(32).toString('hex');
    const [row] = await this.db.withTenant(companyId, sql => sql`
      UPDATE webhook_endpoints SET secret = ${secret}, updated_at = NOW()
      WHERE id = ${endpointId} AND company_id = ${companyId}
      RETURNING id
    `);
    if (!row) throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'No webhook endpoint found with that id.' });
    return { id: row.id, secret };
  }

  async setActive(companyId: string, endpointId: string, isActive: boolean) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      UPDATE webhook_endpoints SET is_active = ${isActive}, updated_at = NOW()
      WHERE id = ${endpointId} AND company_id = ${companyId}
      RETURNING id, is_active
    `);
    if (!row) throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'No webhook endpoint found with that id.' });
    return row;
  }

  async delete(companyId: string, endpointId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      DELETE FROM webhook_endpoints WHERE id = ${endpointId} AND company_id = ${companyId} RETURNING id
    `);
    if (!row) throw new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'No webhook endpoint found with that id.' });
    return { message: 'Webhook endpoint deleted.' };
  }

  async listDeliveries(companyId: string, endpointId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, event_type, status, attempts, last_attempted_at, last_response_status, last_error, created_at
      FROM webhook_deliveries
      WHERE webhook_endpoint_id = ${endpointId} AND company_id = ${companyId}
      ORDER BY created_at DESC LIMIT 50
    `);
  }

  // ── Event emission (called from issues.service.ts / the capture
  // image-processing processor) ────────────────────────────────────────────
  // Never allowed to throw into the caller's write path -- a webhook
  // subscriber being slow/broken/misconfigured must never block or fail the
  // issue/capture operation that triggered it. Same "fire and forget,
  // caller never awaits failure" contract as IssuesService.triggerRiskRecalc().
  async emitEvent(companyId: string, eventType: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
    try {
      const endpoints = await this.db.withTenant(companyId, sql => sql`
        SELECT id FROM webhook_endpoints
        WHERE company_id = ${companyId} AND is_active = true AND ${eventType} = ANY(event_types)
      `);
      if (endpoints.length === 0) return;

      for (const endpoint of endpoints) {
        const [delivery] = await this.db.withTenant(companyId, (sql) => {
          // sql.json(), not JSON.stringify() -- postgres.js's documented
          // helper for binding a JS value as a real jsonb parameter.
          // Interpolating a pre-stringified string here looks identical but
          // stores a JSON *string scalar* holding escaped JSON text instead
          // of the parsed object -- see tenancy.service.ts's updateSettings()
          // comment for the exact failure mode this caused there
          // (confirmed by direct reproduction here too: the delivered
          // webhook body came out double-JSON-encoded).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const payloadJson = sql.json(payload as any);
          return sql`
            INSERT INTO webhook_deliveries (company_id, webhook_endpoint_id, event_type, payload)
            VALUES (${companyId}, ${endpoint.id}, ${eventType}, ${payloadJson})
            RETURNING id
          `;
        });
        await this.deliveryQueue.add(WEBHOOK_DELIVER_JOB_NAME, { companyId, deliveryId: delivery.id as string });
      }
    } catch (error) {
      // Swallow -- see contract note above. Logged, not thrown.
      this.logger.error(`emitEvent(${eventType}) failed to queue delivery`, error);
    }
  }
}
