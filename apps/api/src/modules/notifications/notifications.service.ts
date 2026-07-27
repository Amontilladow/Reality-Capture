import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { PaginationQuery } from '@engineeringos/types';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  createdBy?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DatabaseService) {}

  // Called synchronously from other services (e.g. IssuesService on
  // assignment). Deliberately not fire-and-forget like AiClientService —
  // an in-app notification IS the feature here, not a best-effort side
  // effect, so a failure to write it should surface rather than vanish
  // silently. Callers that want to isolate failures can still wrap this.
  async create(companyId: string, input: CreateNotificationInput) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO notifications
        (company_id, user_id, type, title, body, resource_type, resource_id, created_by)
      VALUES
        (${companyId}, ${input.userId}, ${input.type}, ${input.title},
         ${input.body ?? null}, ${input.resourceType ?? null},
         ${input.resourceId ?? null}, ${input.createdBy ?? null})
      RETURNING id, user_id, type, title, body, resource_type, resource_id, read_at, created_at
    `);
    return row;
  }

  async findAll(companyId: string, userId: string, query: PaginationQuery & { unreadOnly?: boolean }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;
    const unreadOnly = query.unreadOnly ?? false;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        id, type, title, body, resource_type, resource_id, read_at, created_at,
        COUNT(*) OVER() AS full_count
      FROM notifications
      WHERE user_id = ${userId}
        AND (${unreadOnly}::boolean IS FALSE OR read_at IS NULL)
      ORDER BY created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async getUnreadCount(companyId: string, userId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT COUNT(*)::int AS count FROM notifications
      WHERE user_id = ${userId} AND read_at IS NULL
    `);
    return { count: row?.count ?? 0 };
  }

  async markRead(companyId: string, userId: string, id: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      UPDATE notifications
      SET read_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND read_at IS NULL
      RETURNING id, read_at
    `);
    if (!row) {
      // Either it doesn't exist, isn't this user's, or is already read —
      // check existence to give an honest 404 vs a silent no-op.
      const [existing] = await this.db.withTenant(companyId, sql => sql`
        SELECT id, read_at FROM notifications WHERE id = ${id} AND user_id = ${userId}
      `);
      if (!existing) throw new NotFoundException(`Notification ${id} not found.`);
      return existing;
    }
    return row;
  }

  async markAllRead(companyId: string, userId: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      UPDATE notifications
      SET read_at = NOW()
      WHERE user_id = ${userId} AND read_at IS NULL
      RETURNING id
    `);
    return { updated: rows.length };
  }
}
