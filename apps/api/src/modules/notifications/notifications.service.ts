import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DatabaseService } from '../../database/database.service';
import { NotificationsGateway } from './notifications.gateway';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NOTIFICATION_EMAIL_QUEUE, NOTIFICATION_EMAIL_JOB_NAME, type NotificationEmailJobData } from './notification-email.constants';
import { NOTIFICATION_WHATSAPP_QUEUE, NOTIFICATION_WHATSAPP_JOB_NAME, type NotificationWhatsAppJobData } from './notification-whatsapp.constants';
import type { PaginationQuery } from '@engineeringos/types';

// Meta's WhatsApp Cloud API wants plain digits with country code, no
// leading '+', spaces, or punctuation. users.phone is free-text (whatever
// format was typed into the profile form), so this is a best-effort
// normalization, not real E.164 validation; too short after stripping
// almost certainly means "not actually a usable number" rather than a
// real international number, so it's treated the same as no number on file.
function toWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

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
  // Phase 4: NotificationEscalationService's own category, for the
  // unacknowledged-critical-item notification it creates for a manager --
  // never set by any other caller.
  'escalation',
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

// Phase 4 of the notification engine: per-user channel preferences,
// stored in the existing users.preferences JSONB column under a
// 'notifications' sub-key -- same reuse-not-new-column pattern as
// UsersService.update()'s onboardingCompleted. Defaults are deliberately
// asymmetric: email defaults ON (matches Phase 2's original fixed rule,
// so nobody's email notifications silently stop the day this ships) while
// WhatsApp defaults OFF (explicit opt-in required even once Meta
// credentials exist, since it's the one channel with a real per-message
// cost -- master spec section 10's zero-unapproved-cost requirement,
// applied per-user this time rather than per-deployment).
export interface NotificationPreferences {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  mutedCategories: NotificationCategory[];
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
  whatsappEnabled: false,
  mutedCategories: [],
};

function parsePreferences(raw: unknown): NotificationPreferences {
  const stored = (raw as { notifications?: Partial<NotificationPreferences> } | null)?.notifications ?? {};
  return {
    emailEnabled: stored.emailEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.emailEnabled,
    whatsappEnabled: stored.whatsappEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.whatsappEnabled,
    mutedCategories: stored.mutedCategories ?? DEFAULT_NOTIFICATION_PREFERENCES.mutedCategories,
  };
}

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
    private readonly whatsapp: WhatsAppService,
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE) private readonly emailQueue: Queue<NotificationEmailJobData>,
    @InjectQueue(NOTIFICATION_WHATSAPP_QUEUE) private readonly whatsappQueue: Queue<NotificationWhatsAppJobData>,
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

    // Phases 2/3 (email + WhatsApp channels): best-effort, never allowed to
    // fail or slow down the write above -- identical contract to the
    // gateway push. Phase 4 replaces Phases 2/3's original fixed
    // high/critical/actionRequired rules with the user's own preferences,
    // with one deliberate override: 'critical' priority always reaches
    // email regardless of emailEnabled/mutedCategories (an incident a
    // human marked critical should not be silently muted), the same
    // escalation-overrides-preference principle NotificationEscalationService
    // applies on its own timer for unacknowledged items. WhatsApp never
    // gets that override -- see whatsappEnabled's own comment above.
    try {
      await this.dispatchChannels(companyId, row.id as string, input.userId, priority, input.actionRequired ?? false, input.category ?? null);
    } catch (err) {
      this.logger.warn(`Failed to dispatch channel notifications for user ${input.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return row;
  }

  async getPreferences(companyId: string, userId: string): Promise<NotificationPreferences> {
    const [user] = await this.db.withTenant(companyId, sql => sql`
      SELECT preferences FROM users WHERE id = ${userId} AND company_id = ${companyId}
    `);
    return parsePreferences(user?.preferences);
  }

  async updatePreferences(companyId: string, userId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const current = await this.getPreferences(companyId, userId);
    const merged: NotificationPreferences = {
      emailEnabled: patch.emailEnabled ?? current.emailEnabled,
      whatsappEnabled: patch.whatsappEnabled ?? current.whatsappEnabled,
      mutedCategories: patch.mutedCategories ?? current.mutedCategories,
    };
    await this.db.withTenant(companyId, (sql) => {
      // sql.json(), not JSON.stringify() -- see webhooks.service.ts's
      // emitEvent() for the exact double-encoding failure mode this avoids.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = sql.json(merged as any);
      return sql`
        UPDATE users SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{notifications}', ${json})
        WHERE id = ${userId} AND company_id = ${companyId}
      `;
    });
    return merged;
  }

  private async dispatchChannels(
    companyId: string, notificationId: string, userId: string,
    priority: NotificationPriority, actionRequired: boolean, category: NotificationCategory | null,
  ): Promise<void> {
    const [recipient] = await this.db.withTenant(companyId, sql => sql`
      SELECT email, phone, preferences FROM users WHERE id = ${userId} AND is_active = true
    `);
    if (!recipient) return;
    const prefs = parsePreferences(recipient.preferences);
    const categoryMuted = category !== null && prefs.mutedCategories.includes(category);

    const shouldEmail = (priority !== 'normal' || actionRequired)
      && (priority === 'critical' || (prefs.emailEnabled && !categoryMuted));
    if (shouldEmail && recipient.email) {
      try {
        const [delivery] = await this.db.withTenant(companyId, sql => sql`
          INSERT INTO notification_email_deliveries (company_id, notification_id, to_email)
          VALUES (${companyId}, ${notificationId}, ${recipient.email})
          RETURNING id
        `);
        await this.emailQueue.add(NOTIFICATION_EMAIL_JOB_NAME, { companyId, deliveryId: delivery.id as string });
      } catch (err) {
        this.logger.warn(`Failed to enqueue notification email for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // isConfigured() must be checked before this ever creates a delivery
    // row or queues a job, not just before the processor would actually
    // call Meta's API, so a WhatsApp channel without real credentials (or
    // a user who hasn't opted in) costs nothing and leaves no delivery-log
    // noise -- master spec section 10's zero-unapproved-cost requirement.
    const shouldWhatsApp = priority === 'critical' && prefs.whatsappEnabled && this.whatsapp.isConfigured();
    const toPhone = shouldWhatsApp ? toWhatsAppPhone(recipient.phone as string | null) : null;
    if (toPhone) {
      try {
        const [delivery] = await this.db.withTenant(companyId, sql => sql`
          INSERT INTO notification_whatsapp_deliveries (company_id, notification_id, to_phone)
          VALUES (${companyId}, ${notificationId}, ${toPhone})
          RETURNING id
        `);
        await this.whatsappQueue.add(NOTIFICATION_WHATSAPP_JOB_NAME, { companyId, deliveryId: delivery.id as string });
      } catch (err) {
        this.logger.warn(`Failed to enqueue notification WhatsApp message for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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

  // Admin console (master spec section 8): company_admin-gated in the
  // controller via @Roles(), not here -- same split as every other
  // company_admin-only service method in this codebase (e.g.
  // ReportingLinesService.upsert(), which also trusts its controller's
  // @Roles() rather than re-checking the caller's role itself).
  async listEmailDeliveries(companyId: string, query: PaginationQuery) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT d.id, d.to_email, d.status, d.attempts, d.last_attempted_at, d.last_error, d.created_at,
             n.type AS notification_type, n.title AS notification_title,
             COUNT(*) OVER() AS full_count
      FROM notification_email_deliveries d
      JOIN notifications n ON n.id = d.notification_id
      WHERE d.company_id = ${companyId}
      ORDER BY d.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);
    return this.db.paginate(rows, page, perPage);
  }

  async listWhatsAppDeliveries(companyId: string, query: PaginationQuery) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT d.id, d.to_phone, d.status, d.provider_message_id, d.attempts, d.last_attempted_at, d.last_error, d.created_at,
             n.type AS notification_type, n.title AS notification_title,
             COUNT(*) OVER() AS full_count
      FROM notification_whatsapp_deliveries d
      JOIN notifications n ON n.id = d.notification_id
      WHERE d.company_id = ${companyId}
      ORDER BY d.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);
    return this.db.paginate(rows, page, perPage);
  }
}
