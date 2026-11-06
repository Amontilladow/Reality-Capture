import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from './notifications.service';

// How long a critical, action-required notification can sit
// unacknowledged before it escalates to the recipient's manager (master
// spec section 6's own escalation rule). A fixed default for now --
// per-category/per-company configurable thresholds are a natural Phase 4
// follow-up once there's a real admin console surface to set them from,
// but a working fixed rule beats no escalation at all.
const ESCALATION_THRESHOLD_HOURS = 2;

// Runs across every company (same withSystemBypass + per-company
// withTenant() split as IssueScheduledRemindersService's own cron, for
// the same reason: the overdue scan spans company boundaries, but every
// write it makes belongs to one company and must go through that
// company's RLS context). Escalation bypasses the recipient's own
// mute/channel preferences by design -- see dispatchChannels()'s own
// comment in notifications.service.ts for the matching override on the
// *original* notification's email delivery.
@Injectable()
export class NotificationEscalationService {
  private readonly logger = new Logger(NotificationEscalationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/15 * * * *')
  async handleCron() {
    try {
      const result = await this.escalateOverdue();
      if (result.escalated > 0) {
        this.logger.log(`Escalated ${result.escalated} unacknowledged critical notification(s) (${result.checked} overdue).`);
      }
    } catch (err) {
      this.logger.error('Notification escalation check failed', err as Error);
    }
  }

  async escalateOverdue(): Promise<{ checked: number; escalated: number }> {
    // Bound as a real parameter rather than interpolated into the SQL text:
    // `${n}` inside a sql`` tagged template becomes a bind parameter, not a
    // literal substitution, so `INTERVAL '${n} hours'` would try (and fail)
    // to bind a parameter *inside* an already-quoted string literal. A
    // plain JS Date comparison avoids that entirely.
    const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_HOURS * 60 * 60 * 1000);
    const overdue = await this.db.withSystemBypass(sql => sql`
      SELECT id, company_id, user_id, type, title, body, resource_type, resource_id, project_id
      FROM notifications
      WHERE priority = 'critical' AND action_required = true
        AND acknowledged_at IS NULL AND escalated_at IS NULL
        AND created_at <= ${cutoff}
    `);

    let escalated = 0;
    for (const n of overdue) {
      const companyId = n.companyId as string;
      const notificationId = n.id as string;
      const recipientId = n.userId as string;

      // Marked escalated (attempted) regardless of whether a manager is
      // found below: either way, this exact notification should never be
      // re-scanned by the next cron tick.
      await this.db.withTenant(companyId, sql => sql`
        UPDATE notifications SET escalated_at = NOW() WHERE id = ${notificationId} AND company_id = ${companyId}
      `);

      const [line] = await this.db.withTenant(companyId, sql => sql`
        SELECT manager_id FROM workforce_reporting_lines WHERE user_id = ${recipientId}
      `);
      if (!line?.managerId) {
        this.logger.warn(`Notification ${notificationId} is overdue for escalation but user ${recipientId} has no manager configured -- skipping.`);
        continue;
      }

      await this.notifications.create(companyId, {
        userId: line.managerId as string,
        type: `${n.type as string}_escalated`,
        title: `Escalated (unacknowledged ${ESCALATION_THRESHOLD_HOURS}h+): ${n.title as string}`,
        body: n.body as string | null,
        resourceType: n.resourceType as string | null,
        resourceId: n.resourceId as string | null,
        projectId: n.projectId as string | null,
        createdBy: recipientId,
        category: 'escalation',
        priority: 'critical',
        actionRequired: true,
      });
      escalated++;
    }

    return { checked: overdue.length, escalated };
  }
}
