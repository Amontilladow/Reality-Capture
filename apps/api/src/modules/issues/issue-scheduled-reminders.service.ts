import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';

// Fires issue_reminders rows (migration 048) whose scheduled_for has
// passed and that haven't been sent yet -- the counterpart to
// IssuesService.scheduleReminder(). Same 5-minute cadence as
// IssueWarningService's auto-warning cron.
//
// Same cross-tenant bootstrap gap as IssueWarningService.checkOverdueIssues()
// and ScreenshotsService's retention cron (see IssueWarningService's own
// comment for the full explanation): this.db.query has no
// app.current_company_id session var set, so under the app's real DB role
// (app_user, no BYPASS RLS) it currently sees zero rows in production --
// this cron isn't scoped wrong, it's fully blocked, the same way those two
// already-shipped crons are. Flagged, not fixed, as part of the same
// RLS/withTenant audit those cite -- fixing it needs a deliberate
// bootstrap-role/SECURITY DEFINER decision that affects every cross-tenant
// system job in this codebase, not just this one, so it's out of scope
// here rather than being silently "fixed" as a side effect of adding a
// new feature.
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
