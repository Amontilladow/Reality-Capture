import {
  Injectable, NotFoundException, ConflictException, ForbiddenException, Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { AuthService } from '../auth/auth.service';
import { PaymentRequiredException } from '../../common/exceptions/payment-required.exception';
import type { InviteUserDto } from './dto/invite-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { COMPANY_ROLE_WEIGHT, type CompanyRole, type PaginationQuery } from '@engineeringos/types';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly subscription: SubscriptionService,
    private readonly auth: AuthService,
  ) {}

  async findAll(companyId: string, query: PaginationQuery) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;
    const search  = query.search ? `%${query.search}%` : null;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        id, email, first_name, last_name, company_role, requested_company_role,
        organization_name, phone, avatar_url, is_active, last_login_at, created_at,
        COUNT(*) OVER() AS full_count
      FROM users
      WHERE company_id = ${companyId}
        AND is_active = true
        AND (
          ${search}::text IS NULL
          OR LOWER(first_name || ' ' || last_name) LIKE LOWER(${search})
          OR LOWER(email) LIKE LOWER(${search})
        )
      ORDER BY first_name, last_name
      LIMIT ${perPage} OFFSET ${offset}
    `);

    return this.db.paginate(rows, page, perPage);
  }

  async findOne(companyId: string, userId: string) {
    const [user] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, email, first_name, last_name, company_role,
             phone, avatar_url, is_active, last_login_at, created_at, preferences
      FROM users
      WHERE id = ${userId} AND company_id = ${companyId}
    `);

    if (!user) throw new NotFoundException(`User ${userId} not found.`);
    return user;
  }

  async invite(companyId: string, invitedBy: string, invitedByRole: CompanyRole, dto: InviteUserDto) {
    // Phase 6 security fix: RolesGuard only checks that the CALLER's weight
    // clears the @Roles() minimum on this route (project_manager, weight 60)
    // -- it says nothing about the weight of the companyRole the caller is
    // handing to the DTO. Without this check, any project_manager/
    // bim_manager/technical_director/engineering_manager/company_admin could
    // invite a brand-new user with companyRole: 'super_admin' and the
    // service would insert it verbatim (confirmed live during the Phase 6
    // audit: a project_manager-level account successfully minted a
    // super_admin row this way). Cap the requested role to the inviter's
    // own weight -- an inviter can never grant a starting role more
    // senior than themselves.
    if (dto.companyRole && COMPANY_ROLE_WEIGHT[dto.companyRole] > COMPANY_ROLE_WEIGHT[invitedByRole]) {
      throw new ForbiddenException(
        `You cannot invite a user with the role "${dto.companyRole}" -- it outranks your own role. Ask a more senior admin to send this invitation.`,
      );
    }

    // withTenant is required on every statement here -- users has the same
    // tenant_isolation RLS policy as project_members (see addMember/removeMember
    // in projects.service.ts). A plain this.db.query() never sets
    // app.current_company_id, so under any DB role that isn't the table
    // owner/a superuser this SELECT would see no rows, the reactivate UPDATE
    // would silently touch 0 rows, and the INSERT would be rejected outright.
    const [existing] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, is_active FROM users
      WHERE LOWER(email) = LOWER(${dto.email}) AND company_id = ${companyId}
    `);

    if (existing) {
      if (existing.isActive) throw new ConflictException('A user with this email already exists in your company.');
      // Reactivate deactivated user
      await this.db.withTenant(companyId, sql => sql`UPDATE users SET is_active = true, updated_at = NOW() WHERE id = ${existing.id}`);
      return { message: 'User reactivated.' };
    }

    const limitCheck = await this.subscription.checkLimit(companyId, 'users');
    if (!limitCheck.allowed) {
      throw new PaymentRequiredException('users', limitCheck.reason);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

    const [newUser] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO users (
        company_id, email, company_role,
        first_name, last_name,
        invitation_token, invitation_expires_at,
        email_verified
      ) VALUES (
        ${companyId}, ${dto.email.toLowerCase()}, ${dto.companyRole ?? 'client_representative'},
        '', '',
        ${token}, ${expiresAt.toISOString()},
        false
      )
      RETURNING id, email
    `);

    // TODO: send invitation email -- until that exists, the caller (an
    // authenticated admin) gets the raw token back in the response below so
    // they can build/share the accept-invitation link themselves. It must
    // not also go to the server log -- a bearer credential for completing
    // account setup has no business sitting in plaintext log output.
    this.logger.log(`Invitation created for ${dto.email}`);

    return { id: newUser.id, email: newUser.email, invitationSent: true, invitationToken: token };
  }

  async update(companyId: string, requestingUserId: string, requestingUserRole: string, targetUserId: string, dto: UpdateUserDto) {
    const target = await this.findOne(companyId, targetUserId);

    // Only super_admin can change roles or deactivate users -- company_admin
    // has no authority here by default under the permission model (its only
    // inherent authority is creating projects; anything else needs a
    // super_admin-granted per-project permission, which doesn't apply to
    // company-wide user management like this).
    if ((dto.companyRole || dto.isActive !== undefined) && requestingUserRole !== 'super_admin') {
      throw new ForbiddenException('Only a super_admin can change roles or account status.');
    }

    // Users can only edit their own basic profile unless they are admin
    if (requestingUserId !== targetUserId && !['company_admin', 'super_admin'].includes(requestingUserRole)) {
      throw new ForbiddenException('You can only edit your own profile.');
    }

    const hasUpdates = dto.firstName !== undefined || dto.lastName !== undefined
      || dto.phone !== undefined || dto.companyRole !== undefined || dto.isActive !== undefined
      || dto.onboardingCompleted !== undefined;
    if (!hasUpdates) return target;

    // An admin explicitly setting companyRole here *is* the approval action
    // for a pending self-selected-role request, whether they approve it
    // as-requested or override it with something else -- either way clears
    // requested_company_role so PendingApprovalGuard stops blocking them on
    // their next token refresh/login.
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE users SET
        first_name   = COALESCE(${dto.firstName ?? null}, first_name),
        last_name    = COALESCE(${dto.lastName ?? null}, last_name),
        phone        = COALESCE(${dto.phone ?? null}, phone),
        company_role = COALESCE(${dto.companyRole ?? null}, company_role),
        requested_company_role = CASE WHEN ${dto.companyRole ?? null}::company_role_enum IS NOT NULL THEN NULL ELSE requested_company_role END,
        is_active    = COALESCE(${dto.isActive ?? null}, is_active),
        -- Reuses the existing preferences JSONB column -- no new migration,
        -- no new table. Only ever merges the single onboardingCompleted key,
        -- never the whole dto, so nothing else a caller might add here could
        -- accidentally be written into it.
        preferences  = CASE WHEN ${dto.onboardingCompleted ?? null} IS NOT NULL
                         THEN jsonb_set(preferences, '{onboardingCompleted}', to_jsonb(${dto.onboardingCompleted ?? null}::boolean))
                         ELSE preferences END,
        updated_at   = NOW()
      WHERE id = ${targetUserId} AND company_id = ${companyId}
      RETURNING id, email, first_name, last_name, company_role, is_active, requested_company_role, preferences
    `);
    return { ...updated, onboardingCompleted: Boolean((updated.preferences as Record<string, unknown> | null)?.onboardingCompleted) };
  }

  async deactivate(companyId: string, userId: string) {
    // withTenant required -- same tenant_isolation RLS policy as everywhere
    // else in this file. Without it this UPDATE silently touches 0 rows under
    // any DB role that isn't the table owner/a superuser: the endpoint still
    // returns 200 "deactivated", but the account stays fully active and the
    // seat stays occupied. Checking result.count turns that into a real 404
    // instead of a false success.
    const result = await this.db.withTenant(companyId, sql => sql`
      UPDATE users SET is_active = false, updated_at = NOW()
      WHERE id = ${userId} AND company_id = ${companyId}
    `);
    if (result.count === 0) {
      throw new NotFoundException(`User ${userId} not found.`);
    }
    // Revoke all sessions
    await this.db.withTenant(companyId, sql => sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ${userId} AND company_id = ${companyId}`);
    return { message: 'User deactivated and all sessions revoked.' };
  }

  // Admin-assisted password reset -- the fallback for people who can't
  // reliably rely on email (realistic for site-based engineers/draftsmen).
  // Reuses AuthService.forgotPassword()'s exact token scheme
  // (generatePasswordResetToken/buildPasswordResetLink) so a token
  // generated here and one emailed via forgotPassword() are
  // indistinguishable to resetPassword() -- same expiry, same single-use
  // consumption. The only difference is delivery: this returns the raw
  // link in the response for the calling admin to copy and hand to the
  // person directly (WhatsApp, in person, printed on-site), the same
  // manual-delivery pattern invite() already uses for invitationToken.
  async adminResetPassword(companyId: string, targetUserId: string) {
    const target = await this.findOne(companyId, targetUserId); // throws NotFoundException if missing
    if (!target.isActive) {
      throw new ForbiddenException('Cannot reset the password of a deactivated account.');
    }

    const { token, expiresAt } = await this.auth.generatePasswordResetToken(companyId, targetUserId);
    return {
      resetLink: this.auth.buildPasswordResetLink(token),
      expiresAt: expiresAt.toISOString(),
    };
  }
}