import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { EmailService } from '../../email/email.service';
import { buildNotificationEmail } from '../notification-email-templates';
import type { NotificationCategory, NotificationPriority } from '../notifications.service';
import type { NotificationEmailJobData } from '../notification-email.constants';

// Runs in a separate Bull worker, same pattern as WebhookDeliveryProcessor;
// never blocks the request (issue/RFI/etc. write, or NotificationsService
// .create() itself) that triggered the notification. Every attempt updates
// the notification_email_deliveries row independently of Bull's own retry
// bookkeeping, then re-throws on failure so Bull retries with the
// exponential backoff configured in notifications.module.ts.
@Processor('notification-email')
export class NotificationEmailProcessor {
  private readonly logger = new Logger(NotificationEmailProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly email: EmailService,
  ) {}

  @Process('deliver')
  async handleDeliver(job: Job<NotificationEmailJobData>): Promise<void> {
    const { companyId, deliveryId } = job.data;

    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT d.id, d.to_email, n.title, n.body, n.category, n.priority, n.action_required
      FROM notification_email_deliveries d
      JOIN notifications n ON n.id = d.notification_id
      WHERE d.id = ${deliveryId} AND d.company_id = ${companyId}
    `);
    if (!row) {
      this.logger.warn(`Notification email delivery ${deliveryId} not found -- skipping.`);
      return;
    }

    const { subject, text, html } = buildNotificationEmail({
      title: row.title as string,
      body: row.body as string | null,
      category: row.category as NotificationCategory | null,
      priority: row.priority as NotificationPriority,
      actionRequired: row.actionRequired as boolean,
    });

    try {
      await this.email.send(row.toEmail as string, subject, text, html);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email delivery error';
      await this.db.withTenant(companyId, sql => sql`
        UPDATE notification_email_deliveries SET
          attempts = attempts + 1, last_attempted_at = NOW(), status = 'failed', last_error = ${message}
        WHERE id = ${deliveryId} AND company_id = ${companyId}
      `);
      this.logger.warn(`Notification email delivery ${deliveryId} failed: ${message}`);
      throw error; // Re-throw so Bull retries the job
    }

    await this.db.withTenant(companyId, sql => sql`
      UPDATE notification_email_deliveries SET
        attempts = attempts + 1, last_attempted_at = NOW(), status = 'delivered', last_error = NULL
      WHERE id = ${deliveryId} AND company_id = ${companyId}
    `);
  }
}
