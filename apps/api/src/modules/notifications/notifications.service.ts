import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DatabaseService } from '../../database/database.service';
import { NotificationsGateway } from './notifications.gateway';
import { NOTIFICATION_EMAIL_QUEUE, NOTIFICATION_EMAIL_JOB_NAME, type NotificationEmailJobData } from './notification-email.constants';
import type { PaginationQuery } from '@engineeringos/types';

export const NOTIFICATION_PRIORITIES = ['normal', 'high', 'critical'] as const;
export type NotificationPriority = typeof NOTIFICATION_PRIORITIES[number];

// A coarse grouping over the many fine-grained `type` values every caller
// already sets (e.g. 'issue_assigned', 'rfi_overdue'): what the notification
// center's category filter and (future) per-category channel preferences
// operate on. Not exhaustive of every possible future module -- a caller
// that passes an uncategorized type is still stored and delivered, just
// absent from category filtering, so this never blocks a new event type
// from shipping while its category gets sorted out.
export const NOTIFICATION_CATEGORIES = [
  'drawing', 'issue', 'ncr', 'sor', 'rfi', 'submittal', 'assignment', 'approval', 'deadline', 'announcement',
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

// Shared by every module whose own record carries a critical/high/medium/low
// (issues, qaqc_records) or critical/high/normal/low severity: 'critical'
// and 'high' both carry real urgency a notification's own priority should
// reflect (master spec section 6); 'medium'/'low'/anything else collapses
// to 'normal' rather than inventing a 4th notification-priority tier.
export function toNotificationPriority(recordPriority: string | null | undefined): NotificationPriority {
  if (recordPriority === 'critical') return 'critical';
  if (recordPriority === 'high') return 'high';
  return 'normal';
}

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  projectId?: string | null;
  createdBy?: string | null;
  category?: NotificationCategory | null;
  priority?: NotificationPriority;
  actionRequired?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: NotificationsGateway,
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE) private readonly emailQueue: Queue<NotificationEmailJobData>,
  ) {}

  // Called synchronously from other services (e.g. IssuesService on
  // assignment). Deliberately not fire-and-forget like AiClientService;
  // an in-app notification IS the feature here, not a best-effort side
  // effect, so a failure to write it should surface rather than vanish
  // silently. Callers that want to isolate failures can still wrap this.
  async create(companyId: string, input: CreateNotificationInput) {
    const priority = input.priority ?? 'normal';
    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO notifications
        (company_id, user_id, type, title, body, resource_type, resource_id, project_id, created_by,
         category, priority, action_required)
      VALUES
        (${companyId}, ${input.userId}, ${input.type}, ${input.title},
         ${input.body ?? null}, ${input.resourceType ?? null},
         ${input.resourceId ?? null}, ${input.projectId ?? null}, ${input.createdBy ?? null},
         ${input.category ?? null}, ${priority}, ${input.actionRequired ?? false})
      RETURNING id, user_id, type, title, body, resource_type, resource_id, project_id, read_at, created_at,
                category, priority, action_required, acknowledged_at
    `);
    // Real-time push (master spec section 4): best-effort, never allowed to
    // fail the write itself -- a client with no open socket just falls back
    // to the existing poll, same as before this existed.
    try {
      this.gateway.emitToUser(input.userId, row);
    } catch (err) {
      this.logger.warn(`Failed to push real-time notification to user ${input.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 2 of the notification engine (email channel): best-effort,
    // never allowed to fail or slow down the write above -- identical
    // contract to the gateway push just above it. Until Phase 4 adds real
    // per-user/per-category channel preferences, the default rule is the
    // spec's own escalation signal: anything high/critical priority or
    // explicitly action-required also goes out by email, since that's
    // exactly the class of notification a user shouldn't only discover by
    // having the app open.
    if (priority !== 'normal' || input.actionRequired) {
      try {
        await this.enqueueEmail(companyId, row.id as string, input.userId);
      } catch (err) {
        this.logger.warn(`Failed to enqueue notification email for user ${input.userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return row;
  }

  private async enqueueEmail(companyId: string, notificationId: string, userId: string): Promise<void> {
    const [user] = await this.db.withTenant(companyId, sql => sql`
      SELECT email FROM users WHERE id = ${userId} AND is_active = true
    `);
    if (!user?.email) return;

    const [delivery] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO notification_email_deliveries (company_id, notification_id, to_email)
      VALUES (${companyId}, ${notificationId}, ${user.email})
      RETURNING id
    `);
    await this.emailQueue.add(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: delivery.id as string });
  }

  async findAll(companyId: string, userId: string, query: PaginationQuery & { unreadOnly?: boolean; category?: string; search?: string }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;
    // `@Query()` has no decorated DTO class here, so query.unreadOnly never
    // gets coerced from the query-string value "true"/"false" to a real
    // boolean before this point; and interpolating that string with an
    // explicit `::boolean` cast doesn't save it either: confirmed by direct
    // reproduction against postgres.js, a JS *string* parameter cast with
    // `::boolean` comes back `false` for every input, a real serialization
    // bug, not just a missing cast (see issues.service.ts findAll()'s
    // identical fix for the full writeup). Coercing to a real JS
    // boolean here, before it reaches the SQL template, is the fix.
    const unreadOnly = query.unreadOnly === true || (query.unreadOnly as unknown) === 'true';
    const category = query.category || null;
    const search = query.search?.trim() || null;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        id, type, title, body, resource_type, resource_id, project_id, read_at, created_at,
        category, priority, action_required, acknowledged_at,
        COUNT(*) OVER() AS full_count
      FROM notifications
      WHERE user_id = ${userId}
        AND (NOT ${unreadOnly} OR read_at IS NULL)
        AND (${category}::text IS NULL OR category = ${category})
        AND (${search}::text IS NULL OR title ILIKE '%' || ${search} || '%' OR body ILIKE '%' || ${search} || '%')
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
      // Either it doesn't exist, isn't this user's, or is already read;
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

  // Distinct from markRead (master spec section 6: "acknowledgment must be
  // distinct from merely reading a notification"), for the escalation rules
  // a later phase adds: opening the dropdown is not the same signal as a
  // human confirming they will act on an action-required item. Implicitly
  // marks it read too -- there's no real scenario where a notification is
  // acknowledged but still shown as unread.
  async acknowledge(companyId: string, userId: string, id: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      UPDATE notifications
      SET acknowledged_at = COALESCE(acknowledged_at, NOW()), read_at = COALESCE(read_at, NOW())
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, read_at, acknowledged_at
    `);
    if (!row) throw new NotFoundException(`Notification ${id} not found.`);
    return row;
  }
}
