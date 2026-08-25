import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import type { PaginationQuery } from '@engineeringos/types';
import type { CreateMessageDto } from './dto/create-message.dto';
import type { ReplyMessageDto } from './dto/reply-message.dto';

@Injectable()
export class MessagingService {
  constructor(private readonly db: DatabaseService) {}

  // ── Compose ─────────────────────────────────────────────────────────────
  // THE single choke point where a `messages` row is inserted for a new
  // thread. A future email-delivery step (design intent: in-app only for
  // now) adds one call here later -- don't scatter message-INSERT logic
  // anywhere else in this service.
  async create(companyId: string, fromUserId: string, dto: CreateMessageDto) {
    const id = randomUUID();
    const recipientIds = Array.from(new Set(dto.recipientUserIds));

    return this.db.withTenant(companyId, async (sql) => {
      const [message] = await sql`
        INSERT INTO messages (id, company_id, project_id, thread_id, subject, body, from_user_id)
        VALUES (${id}, ${companyId}, ${dto.projectId ?? null}, ${id}, ${dto.subject}, ${dto.body}, ${fromUserId})
        RETURNING id, company_id, project_id, thread_id, subject, body, from_user_id, created_at
      `;

      for (const userId of recipientIds) {
        await sql`
          INSERT INTO message_recipients (company_id, message_id, user_id)
          VALUES (${companyId}, ${id}, ${userId})
        `;
      }

      return message;
    });
  }

  // ── Reply within a thread ───────────────────────────────────────────────
  // The other (and only other) place a `messages` row is inserted.
  async reply(companyId: string, replyingUserId: string, originalMessageId: string, dto: ReplyMessageDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const [original] = await sql`
        SELECT id, thread_id FROM messages WHERE id = ${originalMessageId}
      `;
      if (!original) throw new NotFoundException(`Message ${originalMessageId} not found.`);

      const threadId = original.threadId as string;

      const [participant] = await sql`
        SELECT 1 FROM messages m
        WHERE m.thread_id = ${threadId}
          AND (
            m.from_user_id = ${replyingUserId}
            OR EXISTS (
              SELECT 1 FROM message_recipients mr
              WHERE mr.message_id = m.id AND mr.user_id = ${replyingUserId}
            )
          )
        LIMIT 1
      `;
      if (!participant) {
        throw new ForbiddenException('You are not a participant of this thread.');
      }

      // Subject is inherited from the thread root -- the message whose own
      // id equals the thread_id -- not supplied by the caller.
      const [root] = await sql`
        SELECT subject, project_id FROM messages WHERE id = ${threadId}
      `;

      // Recipient set: every distinct user who has ever sent or received a
      // message in this thread, excluding the replying user themselves.
      const recipientRows = await sql`
        SELECT user_id FROM (
          SELECT from_user_id AS user_id FROM messages WHERE thread_id = ${threadId}
          UNION
          SELECT mr.user_id FROM message_recipients mr
          JOIN messages m ON m.id = mr.message_id
          WHERE m.thread_id = ${threadId}
        ) participants
        WHERE user_id != ${replyingUserId}
      `;

      const id = randomUUID();
      const [message] = await sql`
        INSERT INTO messages (id, company_id, project_id, thread_id, subject, body, from_user_id)
        VALUES (${id}, ${companyId}, ${root.projectId ?? null}, ${threadId}, ${root.subject}, ${dto.body}, ${replyingUserId})
        RETURNING id, company_id, project_id, thread_id, subject, body, from_user_id, created_at
      `;

      for (const row of recipientRows) {
        await sql`
          INSERT INTO message_recipients (company_id, message_id, user_id)
          VALUES (${companyId}, ${id}, ${row.userId})
        `;
      }

      return message;
    });
  }

  // ── Inbox: one row per thread where this user is a recipient ───────────
  async getInbox(companyId: string, userId: string, query: PaginationQuery) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      WITH qualifying_threads AS (
        SELECT DISTINCT m.thread_id
        FROM message_recipients mr
        JOIN messages m ON m.id = mr.message_id
        WHERE mr.user_id = ${userId}
      ),
      latest AS (
        SELECT DISTINCT ON (m.thread_id)
          m.thread_id, m.id AS message_id, m.subject, m.body, m.project_id,
          m.from_user_id, m.created_at
        FROM messages m
        JOIN qualifying_threads qt ON qt.thread_id = m.thread_id
        ORDER BY m.thread_id, m.created_at DESC
      )
      SELECT
        l.thread_id, l.message_id, l.subject, l.body, l.project_id,
        l.from_user_id, u.first_name || ' ' || u.last_name AS from_user_name,
        l.created_at,
        EXISTS (
          SELECT 1 FROM message_recipients mr2
          JOIN messages m2 ON m2.id = mr2.message_id
          WHERE m2.thread_id = l.thread_id AND mr2.user_id = ${userId} AND mr2.read_at IS NULL
        ) AS unread,
        COUNT(*) OVER() AS full_count
      FROM latest l
      JOIN users u ON u.id = l.from_user_id
      ORDER BY l.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  // ── Sent: one row per thread this user started ──────────────────────────
  async getSent(companyId: string, userId: string, query: PaginationQuery) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      WITH qualifying_threads AS (
        SELECT id AS thread_id
        FROM messages
        WHERE id = thread_id AND from_user_id = ${userId}
      ),
      latest AS (
        SELECT DISTINCT ON (m.thread_id)
          m.thread_id, m.id AS message_id, m.subject, m.body, m.project_id,
          m.from_user_id, m.created_at
        FROM messages m
        JOIN qualifying_threads qt ON qt.thread_id = m.thread_id
        ORDER BY m.thread_id, m.created_at DESC
      )
      SELECT
        l.thread_id, l.message_id, l.subject, l.body, l.project_id,
        l.from_user_id, u.first_name || ' ' || u.last_name AS from_user_name,
        l.created_at,
        EXISTS (
          SELECT 1 FROM message_recipients mr2
          JOIN messages m2 ON m2.id = mr2.message_id
          WHERE m2.thread_id = l.thread_id AND mr2.user_id = ${userId} AND mr2.read_at IS NULL
        ) AS unread,
        COUNT(*) OVER() AS full_count
      FROM latest l
      JOIN users u ON u.id = l.from_user_id
      ORDER BY l.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  // ── Full thread ──────────────────────────────────────────────────────────
  async getThread(companyId: string, userId: string, threadId: string) {
    return this.db.withTenant(companyId, async (sql) => {
      const [participant] = await sql`
        SELECT 1 FROM messages m
        WHERE m.thread_id = ${threadId}
          AND (
            m.from_user_id = ${userId}
            OR EXISTS (
              SELECT 1 FROM message_recipients mr
              WHERE mr.message_id = m.id AND mr.user_id = ${userId}
            )
          )
        LIMIT 1
      `;
      if (!participant) {
        throw new ForbiddenException('You are not a participant of this thread.');
      }

      return sql`
        SELECT
          m.id, m.thread_id, m.project_id, m.subject, m.body,
          m.from_user_id, u.first_name || ' ' || u.last_name AS from_user_name,
          m.created_at
        FROM messages m
        JOIN users u ON u.id = m.from_user_id
        WHERE m.thread_id = ${threadId}
        ORDER BY m.created_at ASC
      `;
    });
  }

  // ── Mark read ────────────────────────────────────────────────────────────
  // Resolves `id` to its thread and marks every unread message_recipients
  // row this user has ANYWHERE in that thread, not just the one row for
  // `id` itself. This is deliberate, not the originally-specced "mark this
  // one message read": the frontend's bell/inbox-list "mark read on open"
  // action only has a thread id on hand at that point (the inbox/sent list
  // is one row per THREAD, latest-message-first, not one row per message),
  // and a thread id is always itself a valid messages.id (the thread root's
  // own id, since the root sets thread_id = id) -- so accepting either a
  // thread's root id or any individual message id and resolving to "every
  // unread row in that thread" makes both call sites correct without the
  // frontend needing to track individual message ids per thread, and is
  // the more correct product behavior anyway (opening a thread means
  // you've seen the whole thread, not just its latest row).
  async markRead(companyId: string, userId: string, id: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      UPDATE message_recipients mr
      SET read_at = NOW()
      FROM messages m
      WHERE mr.message_id = m.id
        AND m.thread_id = (SELECT thread_id FROM messages WHERE id = ${id})
        AND mr.user_id = ${userId}
        AND mr.read_at IS NULL
      RETURNING mr.id, mr.read_at
    `);
    if (rows.length === 0) {
      // Either `id` doesn't resolve to any thread, this user has no
      // recipient row in it, or everything in it is already read -- check
      // existence of at least one recipient row for this user in the
      // resolved thread to give an honest 404 vs a silent no-op.
      const [existing] = await this.db.withTenant(companyId, sql => sql`
        SELECT mr.id, mr.read_at
        FROM message_recipients mr
        JOIN messages m ON m.id = mr.message_id
        WHERE m.thread_id = (SELECT thread_id FROM messages WHERE id = ${id})
          AND mr.user_id = ${userId}
        ORDER BY mr.read_at DESC NULLS FIRST
        LIMIT 1
      `);
      if (!existing) throw new NotFoundException(`Message ${id} not found.`);
      return existing;
    }
    return { updated: rows.length };
  }

  // ── Unread count ─────────────────────────────────────────────────────────
  async getUnreadCount(companyId: string, userId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT COUNT(*)::int AS count
      FROM message_recipients mr
      JOIN messages m ON m.id = mr.message_id
      WHERE mr.user_id = ${userId} AND mr.read_at IS NULL
    `);
    return { count: row?.count ?? 0 };
  }
}
