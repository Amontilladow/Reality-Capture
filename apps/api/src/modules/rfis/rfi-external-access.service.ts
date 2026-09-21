import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { RfisService } from './rfis.service';
import type {
  ProjectOrganizationSlot, RfiDiscipline, RfiExternalAccessAction, RfiWorkflowStatus, RfiExternalDetail,
} from '@engineeringos/types';
import type { GenerateExternalAccessDto } from './dto/generate-external-access.dto';
import type { RespondToRfiDto } from './dto/respond-to-rfi.dto';
import type { DecideReviewDto } from './dto/decide-review.dto';
import type { ExternalCommentDto } from './dto/external-comment.dto';

const DEFAULT_EXPIRY_DAYS = 14;

@Injectable()
export class RfiExternalAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly rfis: RfisService,
  ) {}

  // ── Internal, authenticated side (generate/list/revoke) ───────────────────
  // Route-gated with @RequireProjectPermission('manage_rfis'), same as
  // respond/close/reopen -- generating a link that can answer or close an
  // RFI is exactly that sensitive.
  async generate(companyId: string, projectId: string, rfiId: string, userId: string, dto: GenerateExternalAccessDto) {
    await this.rfis.findOne(companyId, projectId, rfiId); // 404s if the RFI doesn't belong to this project/company

    const token = randomBytes(64).toString('hex'); // 128 hex chars -- exact fit for the token VARCHAR(128) column
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);

    const [access] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO rfi_external_access (
        company_id, project_id, rfi_id, organization_slot, action,
        recipient_email, recipient_name, token, expires_at, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${rfiId}, ${dto.organizationSlot}, ${dto.action},
        ${dto.recipientEmail}, ${dto.recipientName ?? null}, ${token}, ${expiresAt.toISOString()}, ${userId}
      )
      RETURNING *
    `);

    const frontendUrl = this.config.get<string>('app.frontendUrl');
    return { ...access, externalUrl: `${frontendUrl}/rfi/external/${token}` };
  }

  // Never selects `token` -- once issued, a link's secret is only ever
  // shown in the generate() response above, matching the "don't re-display
  // a bearer credential" practice already applied elsewhere in this app
  // (e.g. presigned upload URLs are never persisted, only issued fresh).
  async list(companyId: string, projectId: string, rfiId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, organization_slot, action, recipient_email, recipient_name,
             expires_at, revoked_at, revoked_by, used_at, created_by, created_at
      FROM rfi_external_access
      WHERE rfi_id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      ORDER BY created_at DESC
    `);
  }

  async revoke(companyId: string, projectId: string, rfiId: string, accessId: string, userId: string) {
    const [revoked] = await this.db.withTenant(companyId, sql => sql`
      UPDATE rfi_external_access
      SET revoked_at = NOW(), revoked_by = ${userId}
      WHERE id = ${accessId} AND rfi_id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
        AND revoked_at IS NULL
      RETURNING id
    `);
    if (!revoked) throw new NotFoundException({ code: 'EXTERNAL_ACCESS_NOT_FOUND', message: 'No active external access link found with that id.' });
    return { message: 'External access link revoked.' };
  }

  // ── Public, unauthenticated side ───────────────────────────────────────────
  // Deliberately global (this.db.query, no withTenant) -- the token itself
  // is the globally-unique secret; the caller has no session, no
  // company_id, nothing else to identify itself with. Same bootstrap
  // category as auth.service.ts's forgotPassword()/resetPassword(): under
  // the app's real DB role (app_user, no BYPASS RLS -- migration 001),
  // this SELECT against an RLS table with no session var set always sees
  // zero rows in production; flagged as part of the existing RLS/
  // withTenant audit, not fixed here -- this is the same, already-accepted
  // limitation every other pre-tenant lookup in this codebase has, not a
  // new one.
  private async validateToken(token: string, requiredAction?: RfiExternalAccessAction): Promise<Record<string, unknown>> {
    const [access] = await this.db.query`
      SELECT * FROM rfi_external_access
      WHERE token = ${token} AND expires_at > NOW() AND revoked_at IS NULL
    `;

    if (!access) {
      // Same "distinguish why, not just that it failed" courtesy
      // auth.service.ts's acceptInvitation() gives a bad token.
      const [existing] = await this.db.query`SELECT expires_at, revoked_at FROM rfi_external_access WHERE token = ${token}`;
      if (existing?.revokedAt) {
        throw new ForbiddenException({ code: 'LINK_REVOKED', message: 'This link has been revoked. Ask the project team to send a new one.' });
      }
      if (existing && new Date(existing.expiresAt as string) <= new Date()) {
        throw new ForbiddenException({ code: 'LINK_EXPIRED', message: 'This link has expired. Ask the project team to send a new one.' });
      }
      throw new NotFoundException({ code: 'LINK_INVALID', message: 'This link is invalid.' });
    }

    if (requiredAction && access.action !== requiredAction) {
      throw new ForbiddenException({
        code: 'LINK_WRONG_ACTION',
        message: `This link does not authorize the '${requiredAction}' action.`,
      });
    }

    // withTenant required from here on -- company_id is now known, and
    // rfi_external_access carries the same tenant_isolation RLS policy as
    // every other table. Not single-use -- see migration 043's own
    // comment -- so this is "last successful use," not a consumption lock.
    await this.db.withTenant(access.companyId as string, sql => sql`
      UPDATE rfi_external_access SET used_at = NOW() WHERE id = ${access.id} AND company_id = ${access.companyId}
    `);

    return access;
  }

  private attribution(access: Record<string, unknown>) {
    return { recipientEmail: access.recipientEmail as string, organizationSlot: access.organizationSlot as string };
  }

  // First time this company has ever generated an external-access link,
  // create its one reserved, non-login placeholder account so audit_log
  // rows for an action an external token holder takes still attribute to
  // a valid, joinable user_id -- see migration 043's comment for why this
  // is one row per company rather than a single platform-wide row (RLS).
  // ON CONFLICT + re-select mirrors ActivitiesService.
  // resolveOrRegisterApplicationId()'s identical race-safe pattern.
  private async getOrCreateSystemUser(companyId: string): Promise<string> {
    return this.db.withTenant(companyId, async (sql) => {
      const email = `external-rfi@${companyId}.internal`;
      const [existing] = await sql`SELECT id FROM users WHERE company_id = ${companyId} AND email = ${email}`;
      if (existing) return existing.id as string;

      const [created] = await sql`
        INSERT INTO users (company_id, email, first_name, last_name, company_role, is_active, is_system_account)
        VALUES (${companyId}, ${email}, 'External', 'RFI Respondent', 'client_representative', false, true)
        ON CONFLICT (company_id, email) DO NOTHING
        RETURNING id
      `;
      if (created) return created.id as string;

      const [row] = await sql`SELECT id FROM users WHERE company_id = ${companyId} AND email = ${email}`;
      return row.id as string;
    });
  }

  async getByToken(token: string): Promise<RfiExternalDetail> {
    const access = await this.validateToken(token);
    return this.buildExternalDetail(access);
  }

  async respondExternal(token: string, dto: RespondToRfiDto) {
    const access = await this.validateToken(token, 'respond');
    const systemUserId = await this.getOrCreateSystemUser(access.companyId as string);
    return this.rfis.respond(
      access.companyId as string, access.projectId as string, access.rfiId as string, systemUserId, dto,
      this.attribution(access),
    );
  }

  async reviewExternal(token: string, dto: DecideReviewDto) {
    const access = await this.validateToken(token, 'review');
    const systemUserId = await this.getOrCreateSystemUser(access.companyId as string);
    return this.rfis.decideReview(
      access.companyId as string, access.projectId as string, access.rfiId as string, systemUserId, dto,
      this.attribution(access),
    );
  }

  // Valid for any action value ('respond'|'review'|'comment_only') -- a
  // comment is always allowed, whatever this specific link authorizes
  // beyond that.
  async commentExternal(token: string, dto: ExternalCommentDto) {
    const access = await this.validateToken(token);
    const systemUserId = await this.getOrCreateSystemUser(access.companyId as string);
    return this.rfis.addComment(
      access.companyId as string, access.projectId as string, access.rfiId as string, systemUserId,
      { body: dto.body, organizationSlot: access.organizationSlot as ProjectOrganizationSlot },
      this.attribution(access),
    );
  }

  // The deliberately narrow read model -- never findOne()'s full shape,
  // never anything about other RFIs or the wider project.
  private async buildExternalDetail(access: Record<string, unknown>): Promise<RfiExternalDetail> {
    const companyId = access.companyId as string;
    const projectId = access.projectId as string;
    const rfiId = access.rfiId as string;

    return this.db.withTenant(companyId, async (sql) => {
      const [rfi] = await sql`
        SELECT rfi_number, subject, question, discipline, discipline_other, status, due_date, answer
        FROM rfis WHERE id = ${rfiId} AND project_id = ${projectId} AND company_id = ${companyId}
      `;
      if (!rfi) throw new NotFoundException({ code: 'RFI_NOT_FOUND', message: 'RFI not found.' });

      const attachmentRows = await sql`
        SELECT id, filename, storage_key FROM rfi_attachments
        WHERE rfi_id = ${rfiId} AND company_id = ${companyId} AND kind = 'query'
        ORDER BY uploaded_at ASC
      `;
      const urls = await this.storage.resolveUrls(attachmentRows.map(a => a.storageKey as string));

      const commentRows = await sql`
        SELECT c.id, c.body, c.organization_slot, c.created_at, u.first_name || ' ' || u.last_name AS user_name
        FROM rfi_comments c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.rfi_id = ${rfiId} AND c.company_id = ${companyId}
        ORDER BY c.created_at ASC
      `;

      return {
        rfiNumber: rfi.rfiNumber as string | undefined,
        subject: rfi.subject as string,
        question: rfi.question as string,
        discipline: rfi.discipline as RfiDiscipline | undefined,
        disciplineOther: rfi.disciplineOther as string | undefined,
        status: rfi.status as RfiWorkflowStatus,
        dueDate: rfi.dueDate as string | undefined,
        answer: rfi.answer as string | undefined,
        action: access.action as RfiExternalAccessAction,
        organizationSlot: access.organizationSlot as ProjectOrganizationSlot,
        attachments: attachmentRows.map(a => ({
          id: a.id as string,
          filename: a.filename as string,
          attachmentReadUrl: urls.get(a.storageKey as string),
        })),
        comments: commentRows.map(c => ({
          id: c.id as string,
          userName: c.userName as string | undefined,
          organizationSlot: c.organizationSlot as ProjectOrganizationSlot | undefined,
          body: c.body as string,
          createdAt: c.createdAt as string,
        })),
      };
    });
  }
}
