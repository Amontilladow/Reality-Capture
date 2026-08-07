import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';

// Server-side auto-warning check (reference tracker's client-side 60s poll
// re-implemented as a server cron -- 60s is far too chatty for a job that
// does DB writes, so this runs every 5 minutes instead; see ticket 2b).
//
// v1 scope: always-on for every company, no per-company toggle/settings UI.
// That's a deliberate scope reduction, not an oversight -- building a
// settings surface for this is out of scope for 2b (frontend work is
// ticket 3, and there's no "company settings" concept for issues today).
//
// issue_activities.performed_by is NOT NULL REFERENCES users(id), and this
// codebase has no system/service-account user concept anywhere (checked:
// no seeded system user, no nullable performed_by precedent -- audit_log
// is the only table with a nullable user_id, and issue_activities isn't
// audit_log). Rather than relaxing that NOT NULL constraint (a schema
// change to a column ticket 2a never touched, done here without being
// asked), auto-warning activities are attributed to the issue's own
// creator (created_by). Disclosed in the ticket report as a deviation.
@Injectable()
export class IssueWarningService {
  private readonly logger = new Logger(IssueWarningService.name);

  constructor(private readonly db: DatabaseService) {}

  @Cron('*/5 * * * *')
  async handleCron() {
    try {
      const result = await this.checkOverdueIssues();
      if (result.warned > 0) {
        this.logger.log(`Auto-warning: ${result.warned} issue(s) warned (${result.checked} overdue, ${result.skipped} already warned within 24h).`);
      }
    } catch (err) {
      this.logger.error('Auto-warning check failed', err as Error);
    }
  }

  // Extracted from handleCron() so unit tests can invoke the logic directly
  // without depending on @Cron's scheduling.
  async checkOverdueIssues(): Promise<{ checked: number; warned: number; skipped: number }> {
    const overdue = await this.db.query`
      SELECT id, company_id, created_by, deadline
      FROM issues
      WHERE deadline IS NOT NULL
        AND deadline < NOW()
        AND status NOT IN ('closed', 'void')
    `;

    let warned = 0;
    let skipped = 0;

    for (const issue of overdue) {
      const issueId   = issue.id as string;
      const companyId = issue.companyId as string;
      const createdBy = issue.createdBy as string;
      const deadline  = new Date(issue.deadline as string);

      const [recent] = await this.db.query`
        SELECT id FROM issue_activities
        WHERE issue_id = ${issueId}
          AND activity_type = 'auto_warning'
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `;
      if (recent) {
        skipped++;
        continue;
      }

      const overdueDays = Math.max(0, Math.floor((Date.now() - deadline.getTime()) / (1000 * 60 * 60 * 24)));
      const message = overdueDays >= 1
        ? `Auto-warning: issue is overdue by ${overdueDays} day(s).`
        : `Auto-warning: issue is past its deadline.`;

      await this.db.query`
        INSERT INTO issue_activities (issue_id, company_id, activity_type, content, performed_by)
        VALUES (${issueId}, ${companyId}, 'auto_warning', ${message}, ${createdBy})
      `;
      warned++;
    }

    return { checked: overdue.length, warned, skipped };
  }
}
