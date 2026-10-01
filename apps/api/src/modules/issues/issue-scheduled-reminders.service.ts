import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';

// Fires issue_reminders rows (migration 048) whose scheduled_for has
// passed and that haven't been sent yet -- the counterpart to
// IssuesService.scheduleReminder(). Same 5-minute cadence as
// IssueWarningService's auto-warning cron.
//
// Unlike IssueWarningService.checkOverdueIssues() and ScreenshotsService's
// retention cron, this.db.query() here is correct as-is and does not need
// DatabaseService.withSystemBypass() (migration 052): issue_reminders never
// received a tenant_isolation RLS policy in any migration (confirmed by
// grepping every migration's RLS-enabling table list), unlike issues and
// workforce_privacy_settings, which those two crons scan. Querying a table
// with no RLS policy at all behaves the same under app_user as it always
// did -- this cron was never affected by the ownership-bypass gap migration
// 052 fixes, because there was no policy here for ownership to bypass.
// (issue_reminders itself joining the small set of tenant tables that
// never got RLS -- alongside rfis/submittals/transmittals/qa_inspections/
// snag_items, a separate, already-tracked finding -- is worth fixing
// someday, but is not a correctness problem for this specific cron.)
@Injectable()
export class IssueScheduledRemindersService {
  private readonly logger = new Logger(IssueScheduledRemindersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron() {
    try {
      const result = await this.fireDueReminders();
      if (result.fired > 0) {
        this.logger.log(`Fired ${result.fired} scheduled issue reminder(s) (${result.checked} due).`);
      }
    } catch (err) {
      this.logger.error('Scheduled issue reminder check failed', err as Error);
    }
  }

  async fireDueReminders(): Promise<{ checked: number; fired: number }> {
    const due = await this.db.query`
      SELECT id, company_id, project_id, issue_id, sent_by, sent_to, message
      FROM issue_reminders
      WHERE scheduled_for IS NOT NULL AND scheduled_for <= NOW() AND sent_at IS NULL
    `;

    let fired = 0;
    for (const reminder of due) {
      const companyId = reminder.companyId as string;
      const issueId = reminder.issueId as string | null;
      const issue = await this.db.withTenant(companyId, async (sql) => {
        const [row] = issueId
          ? await sql`SELECT issue_number, title FROM issues WHERE id = ${issueId} AND company_id = ${companyId}`
          : [undefined];
        await sql`UPDATE issue_reminders SET sent_at = NOW() WHERE id = ${reminder.id} AND company_id = ${companyId}`;
        if (issueId) {
          await sql`
            INSERT INTO issue_activities (issue_id, company_id, activity_type, content, performed_by)
            VALUES (${issueId}, ${companyId}, 'reminder', ${reminder.message}, ${reminder.sentBy})
          `;
        }
        return row;
      });

      if (reminder.sentTo) {
        await this.notifications.create(companyId, {
          userId: reminder.sentTo as string,
          type: 'issue_reminder',
          title: issue ? `Reminder: issue ${issue.issueNumber as string}: ${issue.title as string}` : 'Issue reminder',
          body: reminder.message as string,
          resourceType: 'issue',
          resourceId: issueId ?? undefined,
          projectId: reminder.projectId as string,
          createdBy: reminder.sentBy as string,
        });
      }
      fired++;
    }

    return { checked: due.length, fired };
  }
}
