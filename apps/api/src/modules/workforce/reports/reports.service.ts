import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { computeFactors, type ActivityAggregateRow } from '../productivity/productivity.service';

const DEFAULT_RANGE_DAYS = 7;

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  // Company-wide, one row per active user -- DeskTime's own "Reports"
  // screen (a table of everyone's tracked/productive time for a period),
  // not a per-employee drill-down. Deliberately admin-only rather than
  // reporting-chain-scoped like ActivitiesService/ProductivityService:
  // company_admin+ is already "sees everyone" by RBAC weight, and a
  // company-wide export is exactly the admin-facing artifact this screen
  // is for (payroll/compliance review, not a manager's team view).
  async getCompanySummary(companyId: string, from?: string, to?: string) {
    const rangeEnd = to ? new Date(to) : new Date();
    const rangeStart = from ? new Date(from) : new Date(rangeEnd.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

    return this.db.withTenant(companyId, async (sql) => {
      const users = await sql`
        SELECT id, first_name, last_name, company_role
        FROM users
        WHERE is_active = true
        ORDER BY first_name, last_name`;

      const rows = await sql`
        SELECT a.user_id, a.duration_seconds, a.activity_type, a.application_id,
               COALESCE(ar.name, a.application_name_raw) AS application_name,
               ar.engineering_relevance, ar.productivity_classification
        FROM activities a
        LEFT JOIN application_registry ar ON ar.id = a.application_id
        WHERE a.started_at >= ${rangeStart.toISOString()}
          AND a.started_at < ${rangeEnd.toISOString()}`;

      const rowsByUser = new Map<string, ActivityAggregateRow[]>();
      for (const row of rows) {
        const userId = row.userId as string;
        const list = rowsByUser.get(userId) ?? [];
        list.push(row as unknown as ActivityAggregateRow);
        rowsByUser.set(userId, list);
      }

      return users.map((u) => {
        const factors = computeFactors(rowsByUser.get(u.id as string) ?? []);
        return {
          userId: u.id as string,
          name: `${u.firstName as string} ${u.lastName as string}`,
          companyRole: u.companyRole as string,
          totalActiveSeconds: factors.totalActiveSeconds,
          engineeringShare: factors.engineeringShare,
          productiveSeconds: factors.productiveSeconds ?? 0,
          unproductiveSeconds: factors.unproductiveSeconds ?? 0,
          neutralSeconds: factors.neutralSeconds ?? 0,
          unclassifiedSeconds: factors.unclassifiedSeconds ?? 0,
          productivityRatio: factors.productivityRatio ?? 0,
        };
      });
    });
  }
}
