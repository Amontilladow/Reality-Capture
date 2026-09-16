import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class ReportingLinesService {
  constructor(private readonly db: DatabaseService) {}

  async list(companyId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT
        wrl.user_id, wrl.manager_id,
        u.first_name AS user_first_name, u.last_name AS user_last_name,
        m.first_name AS manager_first_name, m.last_name AS manager_last_name
      FROM workforce_reporting_lines wrl
      JOIN users u ON u.id = wrl.user_id
      JOIN users m ON m.id = wrl.manager_id
      ORDER BY u.first_name, u.last_name`);
  }

  // Upsert -- one manager per user (workforce_reporting_lines.user_id is
  // UNIQUE), so setting a new manager for someone who already has one just
  // replaces the row rather than requiring a separate "remove" step first.
  async upsert(companyId: string, adminUserId: string, userId: string, managerId: string) {
    if (userId === managerId) {
      throw new BadRequestException({ code: 'INVALID_REPORTING_LINE', message: 'A user cannot be their own manager.' });
    }

    return this.db.withTenant(companyId, async (sql) => {
      const [user] = await sql`SELECT id FROM users WHERE id = ${userId}`;
      if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });

      const [manager] = await sql`SELECT id FROM users WHERE id = ${managerId}`;
      if (!manager) throw new NotFoundException({ code: 'MANAGER_NOT_FOUND', message: 'Manager not found.' });

      const [row] = await sql`
        INSERT INTO workforce_reporting_lines (company_id, user_id, manager_id, created_by)
        VALUES (${companyId}, ${userId}, ${managerId}, ${adminUserId})
        ON CONFLICT (user_id) DO UPDATE SET
          manager_id = EXCLUDED.manager_id,
          created_by = EXCLUDED.created_by,
          created_at = NOW()
        RETURNING *`;
      return row;
    });
  }
}
