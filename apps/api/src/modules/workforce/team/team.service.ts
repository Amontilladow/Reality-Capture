import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { resolveDownlineUserIds } from '../workforce-visibility.util';

@Injectable()
export class TeamService {
  constructor(private readonly db: DatabaseService) {}

  // Everyone in the caller's downward reporting closure (direct reports and
  // their reports, recursively), for populating a team list in the UI. This
  // is purely reporting-line based -- it does not also list the whole
  // company for a weight-based leadership viewer (that override only
  // applies to viewing a specific, already-known user's activity via
  // ActivitiesService/ProductivityService, not to "who is on my team").
  // An individual contributor with no reporting-line rows simply gets [].
  async getMyTeam(companyId: string, viewerId: string) {
    return this.db.withTenant(companyId, async (sql) => {
      const downlineIds = await resolveDownlineUserIds(sql, viewerId);
      if (downlineIds.length === 0) return [];

      const rows = await sql`
        SELECT id, first_name, last_name, company_role
        FROM users
        WHERE id = ANY(${downlineIds})
        ORDER BY first_name, last_name`;

      return rows.map(r => ({
        userId: r.id as string,
        name: `${r.firstName as string} ${r.lastName as string}`,
        companyRole: r.companyRole as string,
      }));
    });
  }
}
