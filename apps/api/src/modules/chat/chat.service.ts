import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { PaginationQuery, CompanyRole } from '@engineeringos/types';

export type ChatChannelType = 'project' | 'dm';

@Injectable()
export class ChatService {
  constructor(private readonly db: DatabaseService) {}

  // ── Shared membership check ─────────────────────────────────────────────
  // Used by both the gateway (chat:join / chat:send) and the REST history
  // endpoints, so the membership rule lives in exactly one place. Mirrors
  // ProjectPermissionGuard's own super_admin bypass and project_members
  // lookup for 'project' channels; for 'dm' channels it confirms the
  // channel's own pair actually includes this user.
  async canAccessChannel(
    companyId: string,
    userId: string,
    companyRole: CompanyRole,
    channelType: ChatChannelType,
    channelId: string,
  ): Promise<boolean> {
    if (companyRole === 'super_admin') return true;

    if (channelType === 'project') {
      const [membership] = await this.db.withTenant(companyId, sql => sql`
        SELECT role FROM project_members WHERE project_id = ${channelId} AND user_id = ${userId}
      `);
      return !!membership;
    }

    const [channel] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM chat_dm_channels
      WHERE id = ${channelId} AND (user_a_id = ${userId} OR user_b_id = ${userId})
    `);
    return !!channel;
  }

  // ── Compose ──────────────────────────────────────────────────────────────
  // THE sole place a `chat_messages` row is ever inserted.
  async sendMessage(
    companyId: string,
    fromUserId: string,
    companyRole: CompanyRole,
    channelType: ChatChannelType,
    channelId: string,
    body: string,
  ) {
    const allowed = await this.canAccessChannel(companyId, fromUserId, companyRole, channelType, channelId);
    if (!allowed) {
      throw channelType === 'project'
        ? new ForbiddenException('You are not a member of this project.')
        : new NotFoundException('DM channel not found.');
    }

    return this.db.withTenant(companyId, async (sql) => {
      const [message] = await sql`
        INSERT INTO chat_messages (company_id, channel_type, channel_id, from_user_id, body)
        VALUES (${companyId}, ${channelType}, ${channelId}, ${fromUserId}, ${body})
        RETURNING id, company_id, channel_type, channel_id, from_user_id, body, created_at
      `;
      const [sender] = await sql`
        SELECT first_name || ' ' || last_name AS from_user_name FROM users WHERE id = ${fromUserId}
      `;
      return { ...message, fromUserName: sender?.fromUserName ?? '' };
    });
  }

  // ── Find-or-create a DM channel for an unordered pair of users ─────────
  async getOrCreateDmChannel(companyId: string, userAId: string, userBId: string) {
    const [a, b] = [userAId, userBId].sort();

    return this.db.withTenant(companyId, async (sql) => {
      const [inserted] = await sql`
        INSERT INTO chat_dm_channels (company_id, user_a_id, user_b_id)
        VALUES (${companyId}, ${a}, ${b})
        ON CONFLICT (user_a_id, user_b_id) DO NOTHING
        RETURNING *
      `;
      if (inserted) return inserted;

      const [existing] = await sql`
        SELECT * FROM chat_dm_channels WHERE user_a_id = ${a} AND user_b_id = ${b}
      `;
      return existing;
    });
  }

  // ── Project channel history (oldest to newest) ──────────────────────────
  async getProjectChannelHistory(companyId: string, userId: string, companyRole: CompanyRole, projectId: string, query: PaginationQuery) {
    const allowed = await this.canAccessChannel(companyId, userId, companyRole, 'project', projectId);
    if (!allowed) throw new ForbiddenException('You are not a member of this project.');

    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        m.id, m.channel_type, m.channel_id, m.from_user_id,
        u.first_name || ' ' || u.last_name AS from_user_name,
        m.body, m.created_at,
        COUNT(*) OVER() AS full_count
      FROM chat_messages m
      JOIN users u ON u.id = m.from_user_id
      WHERE m.channel_type = 'project' AND m.channel_id = ${projectId}
      ORDER BY m.created_at ASC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  // ── DM history (oldest to newest); creates the channel on first contact ─
  async getDmHistory(companyId: string, userId: string, otherUserId: string, query: PaginationQuery) {
    const channel = await this.getOrCreateDmChannel(companyId, userId, otherUserId);

    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        m.id, m.channel_type, m.channel_id, m.from_user_id,
        u.first_name || ' ' || u.last_name AS from_user_name,
        m.body, m.created_at,
        COUNT(*) OVER() AS full_count
      FROM chat_messages m
      JOIN users u ON u.id = m.from_user_id
      WHERE m.channel_type = 'dm' AND m.channel_id = ${channel.id}
      ORDER BY m.created_at ASC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return { channelId: channel.id as string, ...this.db.paginate(rows, page, perPage) };
  }

  // ── DM threads: one row per DM conversation this user is part of ───────
  async getDmThreads(companyId: string, userId: string) {
    return this.db.withTenant(companyId, sql => sql`
      WITH my_channels AS (
        SELECT id, user_a_id, user_b_id
        FROM chat_dm_channels
        WHERE user_a_id = ${userId} OR user_b_id = ${userId}
      ),
      latest AS (
        SELECT DISTINCT ON (m.channel_id)
          m.channel_id, m.id AS message_id, m.body, m.from_user_id, m.created_at
        FROM chat_messages m
        JOIN my_channels mc ON mc.id = m.channel_id
        WHERE m.channel_type = 'dm'
        ORDER BY m.channel_id, m.created_at DESC
      )
      SELECT
        mc.id AS channel_id,
        other.id AS other_user_id,
        other.first_name || ' ' || other.last_name AS other_user_name,
        l.message_id, l.body AS last_message_body, l.from_user_id AS last_from_user_id, l.created_at AS last_message_at,
        EXISTS (
          SELECT 1 FROM chat_messages cm
          LEFT JOIN chat_reads cr ON cr.channel_type = 'dm' AND cr.channel_id = mc.id AND cr.user_id = ${userId}
          WHERE cm.channel_type = 'dm' AND cm.channel_id = mc.id
            AND cm.from_user_id != ${userId}
            AND cm.created_at > COALESCE(cr.last_read_at, '-infinity'::timestamptz)
        ) AS unread
      FROM my_channels mc
      JOIN users other ON other.id = (CASE WHEN mc.user_a_id = ${userId} THEN mc.user_b_id ELSE mc.user_a_id END)
      LEFT JOIN latest l ON l.channel_id = mc.id
      ORDER BY l.created_at DESC NULLS LAST
    `);
  }

  // ── Unread count across every channel this user is part of ─────────────
  async getUnreadCount(companyId: string, userId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      WITH my_channels AS (
        SELECT p.id AS channel_id, 'project' AS channel_type
        FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = ${userId}
        UNION ALL
        SELECT id AS channel_id, 'dm' AS channel_type
        FROM chat_dm_channels
        WHERE user_a_id = ${userId} OR user_b_id = ${userId}
      )
      SELECT COUNT(*)::int AS count
      FROM chat_messages cm
      JOIN my_channels mc ON mc.channel_id = cm.channel_id AND mc.channel_type = cm.channel_type
      LEFT JOIN chat_reads cr ON cr.channel_type = cm.channel_type AND cr.channel_id = cm.channel_id AND cr.user_id = ${userId}
      WHERE cm.from_user_id != ${userId}
        AND cm.created_at > COALESCE(cr.last_read_at, '-infinity'::timestamptz)
    `);
    return { count: row?.count ?? 0 };
  }

  // ── Mark read ────────────────────────────────────────────────────────────
  async markRead(companyId: string, userId: string, channelType: ChatChannelType, channelId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO chat_reads (company_id, channel_type, channel_id, user_id, last_read_at)
      VALUES (${companyId}, ${channelType}, ${channelId}, ${userId}, NOW())
      ON CONFLICT (channel_type, channel_id, user_id) DO UPDATE SET last_read_at = NOW()
      RETURNING id, channel_type, channel_id, user_id, last_read_at
    `);
    return row;
  }
}
