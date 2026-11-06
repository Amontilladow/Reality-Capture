import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import type { NotificationWhatsAppJobData } from '../notification-whatsapp.constants';

// Runs in a separate Bull worker, same pattern as NotificationEmailProcessor
// and WebhookDeliveryProcessor; never blocks the write that triggered the
// notification. NotificationsService.create() already checks
// WhatsAppService.isConfigured() before enqueueing at all (so this never
// runs for real until Meta credentials exist), but checks again here too
// -- a job queued just before credentials were removed/rotated should
// still fail cleanly rather than throw an unclear error from deep inside
// sendTemplateMessage().
@Processor('notification-whatsapp')
export class NotificationWhatsAppProcessor {
  private readonly logger = new Logger(NotificationWhatsAppProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Process('deliver')
  async handleDeliver(job: Job<NotificationWhatsAppJobData>): Promise<void> {
    const { companyId, deliveryId } = job.data;

    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT d.id, d.to_phone, n.title, n.body
      FROM notification_whatsapp_deliveries d
      JOIN notifications n ON n.id = d.notification_id
      WHERE d.id = ${deliveryId} AND d.company_id = ${companyId}
    `);
    if (!row) {
      this.logger.warn(`Notification WhatsApp delivery ${deliveryId} not found -- skipping.`);
      return;
    }

    if (!this.whatsapp.isConfigured()) {
      await this.db.withTenant(companyId, sql => sql`
        UPDATE notification_whatsapp_deliveries SET
          attempts = attempts + 1, last_attempted_at = NOW(), status = 'skipped_not_configured', last_error = 'WhatsApp Business API not configured'
        WHERE id = ${deliveryId} AND company_id = ${companyId}
      `);
      return; // Not an error worth retrying -- credentials either exist or they don't.
    }

    const opaqueCallbackData = JSON.stringify({ companyId, deliveryId });

    try {
      const { messageId } = await this.whatsapp.sendTemplateMessage(
        row.toPhone as string, row.title as string, (row.body as string | null) ?? '', opaqueCallbackData,
      );
      await this.db.withTenant(companyId, sql => sql`
        UPDATE notification_whatsapp_deliveries SET
          attempts = attempts + 1, last_attempted_at = NOW(), status = 'sent', provider_message_id = ${messageId}, last_error = NULL
        WHERE id = ${deliveryId} AND company_id = ${companyId}
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown WhatsApp delivery error';
      await this.db.withTenant(companyId, sql => sql`
        UPDATE notification_whatsapp_deliveries SET
          attempts = attempts + 1, last_attempted_at = NOW(), status = 'failed', last_error = ${message}
        WHERE id = ${deliveryId} AND company_id = ${companyId}
      `);
      this.logger.warn(`Notification WhatsApp delivery ${deliveryId} failed: ${message}`);
      throw error; // Re-throw so Bull retries the job
    }
  }
}
