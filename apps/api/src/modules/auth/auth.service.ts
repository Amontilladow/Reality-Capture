import {
  Injectable, UnauthorizedException, BadRequestException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import type { LoginDto } from './dto/login.dto';
import type { RefreshTokenDto } from './dto/refresh-token.dto';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { AuthTokens, JwtPayload, AuthenticatedUser, CompanyRole } from '@engineeringos/types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<{ tokens: AuthTokens; user: AuthenticatedUser }> {
    // Find user — email is globally unique across the platform (unique per company, but
    // we search globally so users with the same email at different companies get a clear error).
    // NOTE: under the app's real DB role (app_user, no BYPASS RLS -- migration 001), this
    // SELECT against `users` (an RLS table) with no session var set sees zero rows, always
    // -- there's no companyId to withTenant() by here, that's the whole point of a global
    // lookup. Flagged as part of the RLS/withTenant audit, not fixed: needs a deliberate
    // bootstrap mechanism (e.g. SECURITY DEFINER function / dedicated role), same as
    // tenancy.service.ts's register() and issue-warning.service.ts's checkOverdueIssues().
    const [user] = await this.db.query`
      SELECT u.*, c.is_active AS company_active
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE LOWER(u.email) = LOWER(${dto.email})
      LIMIT 1
    `;

    if (!user) throw new UnauthorizedException('Invalid email or password.');
    if (!user.isActive) throw new UnauthorizedException('Your account has been deactivated. Contact your administrator.');
    if (!user.companyActive) throw new UnauthorizedException('Your company account is inactive. Contact support.');
    if (!user.passwordHash) throw new UnauthorizedException('This account uses social login. Use the SSO option.');

    const passwordValid = await argon2.verify(user.passwordHash as string, dto.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid email or password.');

    // Update last login timestamp (fire-and-forget — don't block the response).
    // withTenant required -- users carries the tenant_isolation RLS policy; company_id is
    // known now that the user row has been found, unlike the lookup above.
    this.db.withTenant(user.companyId as string, sql => sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id} AND company_id = ${user.companyId}`).catch(e =>
      this.logger.error('Failed to update last_login_at', e),
    );

    const tokens = await this.issueTokens(user, ipAddress, userAgent);

    return {
      tokens,
      user: {
        id: user.id as string,
        email: user.email as string,
        companyId: user.companyId as string,
        companyRole: user.companyRole as CompanyRole,
        firstName: user.firstName as string,
        lastName: user.lastName as string,
        pendingApproval: Boolean(user.requestedCompanyRole),
      },
    };
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  async refresh(dto: RefreshTokenDto, ipAddress?: string, userAgent?: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(dto.refreshToken);

    // Select rt.id under its own alias -- `rt.*` here would otherwise collide
    // with u.id below (both output as `id`), and the *last* one selected
    // silently wins when the row is built. That previously left `stored.id`
    // holding the refresh token's own row id instead of the user's id, which
    // issueTokens() then used as the new token's `user_id`, violating the
    // refresh_tokens.user_id -> users.id foreign key on every refresh.
    // requested_company_role must be selected here too -- issueTokens() below
    // uses it to set the JWT's pendingApproval claim, and this is an explicit
    // column list (unlike login()'s SELECT u.*), so it's easy to silently
    // lose. Missing it here would mean a still-pending user's access token
    // stops carrying pendingApproval the moment they refresh it, bypassing
    // PendingApprovalGuard after as little as 15 minutes.
    const [stored] = await this.db.query`
      SELECT rt.id AS refresh_token_id, u.id, u.company_id, u.company_role, u.email,
             u.first_name, u.last_name, u.is_active, u.requested_company_role,
             c.is_active AS company_active
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      JOIN companies c ON c.id = u.company_id
      WHERE rt.token_hash = ${tokenHash}
        AND rt.revoked_at IS NULL
        AND rt.expires_at > NOW()
    `;

    if (!stored) throw new UnauthorizedException('Invalid or expired refresh token.');
    if (!stored.isActive || !stored.companyActive) throw new UnauthorizedException('Account deactivated.');

    // Rotate the token — revoke old, issue new (prevents token reuse).
    // withTenant required -- refresh_tokens carries the tenant_isolation RLS policy;
    // company_id is known now (stored.companyId), unlike the lookup above.
    await this.db.withTenant(stored.companyId as string, sql => sql`
      UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ${stored.refreshTokenId} AND company_id = ${stored.companyId}
    `);

    return this.issueTokens(stored, ipAddress, userAgent);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  // Unlike login()/refresh(), this route is authenticated (not @Public()), so companyId
  // is already known from the caller's JWT -- withTenant applies here, no bootstrap issue.
  async logout(refreshToken: string, companyId: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.db.withTenant(companyId, sql => sql`
      UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL AND company_id = ${companyId}
    `);
  }

  // ── Accept invitation ─────────────────────────────────────────────────────
  async acceptInvitation(dto: AcceptInvitationDto): Promise<{ tokens: AuthTokens; user: AuthenticatedUser }> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    // Atomic check-and-consume: the old code did a separate SELECT to
    // validate the token, then a separate UPDATE to consume it. Two
    // concurrent accept requests on the same fresh token could both pass
    // that SELECT before either UPDATE committed -- confirmed by hand,
    // firing two genuinely concurrent requests at the same token: both
    // returned 200 with a valid session for the same user row, and
    // whichever UPDATE committed last silently won the name/password,
    // with no error to either caller. A single UPDATE ... WHERE ...
    // RETURNING is one indivisible operation per row -- Postgres itself
    // guarantees only one concurrent request can ever match this WHERE
    // clause, so this closes the race at the database level rather than
    // trying to catch it in application code.
    //
    // Deliberately does NOT null out invitation_token on success (unlike
    // before) -- keeping it lets the lookup below, on the failure path,
    // tell "already used" apart from "never existed"/"expired" instead of
    // collapsing all three into one generic message. It's permanently
    // inert either way once email_verified flips to true, since that's
    // what the WHERE clause actually guards on.
    //
    // Deliberately global -- the invitation token itself is the globally-unique secret;
    // the caller doesn't know (and shouldn't need to know) which company they're in yet.
    // Same bootstrap category as login(): under the app's real DB role (app_user, no
    // BYPASS RLS -- migration 001), this UPDATE against `users` (an RLS table) with no
    // session var set always matches zero rows, so invitation acceptance is currently
    // broken in production. Not fixable by adding withTenant here (no companyId exists
    // to scope by) -- flagged as part of the RLS/withTenant audit, not fixed.
    const [user] = await this.db.query`
      UPDATE users SET
        first_name = ${dto.firstName},
        last_name  = ${dto.lastName},
        password_hash = ${passwordHash},
        email_verified = true,
        invitation_expires_at = NULL,
        requested_company_role = ${dto.requestedRole},
        updated_at = NOW()
      WHERE invitation_token = ${dto.token}
        AND invitation_expires_at > NOW()
        AND email_verified = false
      RETURNING *
    `;

    if (user) {
      const tokens = await this.issueTokens(user);
      return {
        tokens,
        user: {
          id: user.id as string,
          email: user.email as string,
          companyId: user.companyId as string,
          companyRole: user.companyRole as CompanyRole,
          firstName: dto.firstName,
          lastName: dto.lastName,
          // Always true right after accepting -- every self-registration is
          // pending until a company_admin/super_admin approves it.
          pendingApproval: true,
        },
      };
    }

    // The UPDATE above matched nothing -- work out why, for a clearer
    // message than one generic catch-all.
    const [existing] = await this.db.query`
      SELECT email_verified, invitation_expires_at FROM users WHERE invitation_token = ${dto.token}
    `;
    if (existing?.emailVerified) {
      throw new BadRequestException('This invitation has already been used.');
    }
    if (existing && new Date(existing.invitationExpiresAt as string) <= new Date()) {
      throw new BadRequestException('This invitation has expired.');
    }
    throw new BadRequestException('Invitation token is invalid.');
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  async forgotPassword(email: string): Promise<void> {
    // Deliberately global -- email is unique platform-wide, and the caller doesn't know
    // (and shouldn't need to know) which company they're in yet. Same bootstrap category
    // as login().
    const [user] = await this.db.query`
      SELECT id, company_id FROM users WHERE LOWER(email) = LOWER(${email}) AND is_active = true
    `;

    // Always return success — never reveal whether an email exists (enumeration attack prevention)
    if (!user) return;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

    // withTenant required from here on -- company_id is known now that the user row has
    // been found. users carries the tenant_isolation RLS policy.
    await this.db.withTenant(user.companyId as string, sql => sql`
      UPDATE users SET
        password_reset_token = ${token},
        password_reset_expires_at = ${expiresAt.toISOString()},
        updated_at = NOW()
      WHERE id = ${user.id} AND company_id = ${user.companyId}
    `);

    // TODO Phase 2: send email via notification service
    this.logger.log(`Password reset token generated for user ${user.id as string}`);
  }

  // ── Reset password ────────────────────────────────────────────────────────
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // Deliberately global -- the reset token itself is the globally-unique secret; the
    // caller doesn't know (and shouldn't need to know) which company they're in yet. Same
    // bootstrap category as login().
    const [user] = await this.db.query`
      SELECT id, company_id FROM users
      WHERE password_reset_token = ${dto.token}
        AND password_reset_expires_at > NOW()
        AND is_active = true
    `;

    if (!user) throw new BadRequestException('Reset token is invalid or has expired.');

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });

    // withTenant required from here on -- company_id is known now that the user row has
    // been found. users and refresh_tokens both carry the tenant_isolation RLS policy.
    await this.db.withTenant(user.companyId as string, async (sql) => {
      await sql`
        UPDATE users SET
          password_hash = ${passwordHash},
          password_reset_token = NULL,
          password_reset_expires_at = NULL,
          updated_at = NOW()
        WHERE id = ${user.id} AND company_id = ${user.companyId}
      `;

      // Revoke all existing refresh tokens — force re-login everywhere
      await sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ${user.id} AND company_id = ${user.companyId}`;
    });
  }

  // ── Get current user ──────────────────────────────────────────────────────
  // @AllowPending() on the controller route -- a pending user can reach this
  // (needed so the "Awaiting Approval" screen can show who they are and what
  // they requested) even though PendingApprovalGuard blocks everything else.
  async getMe(userId: string, companyId: string): Promise<AuthenticatedUser & { phone?: string; avatarUrl?: string; lastLoginAt?: string; requestedCompanyRole?: CompanyRole }> {
    const [user] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, email, first_name, last_name, company_id, company_role,
             phone, avatar_url, last_login_at, requested_company_role
      FROM users WHERE id = ${userId}
    `);

    if (!user) throw new UnauthorizedException('User not found.');

    return {
      id: user.id as string,
      email: user.email as string,
      companyId: user.companyId as string,
      companyRole: user.companyRole as CompanyRole,
      firstName: user.firstName as string,
      lastName: user.lastName as string,
      phone: user.phone as string | undefined,
      avatarUrl: user.avatarUrl as string | undefined,
      lastLoginAt: user.lastLoginAt as string | undefined,
      pendingApproval: Boolean(user.requestedCompanyRole),
      requestedCompanyRole: user.requestedCompanyRole as CompanyRole | undefined,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private async issueTokens(
    user: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id as string,
      email: user.email as string,
      companyId: user.companyId as string,
      companyRole: user.companyRole as CompanyRole,
      firstName: user.firstName as string,
      lastName: user.lastName as string,
      pendingApproval: Boolean(user.requestedCompanyRole),
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    const rawRefreshToken = randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // withTenant required -- refresh_tokens carries the tenant_isolation RLS policy. A plain
    // this.db.query() never sets app.current_company_id, so under any DB role that isn't the
    // table owner/a superuser the implicit WITH CHECK rejects this insert outright with
    // "new row violates row-level security policy" -- meaning every successful login/refresh/
    // accept-invitation would currently throw here.
    await this.db.withTenant(payload.companyId, sql => sql`
      INSERT INTO refresh_tokens (user_id, company_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (${payload.sub}, ${payload.companyId}, ${tokenHash}, ${expiresAt.toISOString()},
              ${ipAddress ?? null}, ${userAgent ?? null})
    `);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}