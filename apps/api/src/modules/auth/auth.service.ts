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
    // we search globally so users with the same email at different companies get a clear error)
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

    // Update last login timestamp (fire-and-forget — don't block the response)
    this.db.query`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`.catch(e =>
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

    // Rotate the token — revoke old, issue new (prevents token reuse)
    await this.db.query`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ${stored.refreshTokenId}`;

    return this.issueTokens(stored, ipAddress, userAgent);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.db.query`
      UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
    `;
  }

  // ── Accept invitation ─────────────────────────────────────────────────────
  async acceptInvitation(dto: AcceptInvitationDto): Promise<{ tokens: AuthTokens; user: AuthenticatedUser }> {
    const [user] = await this.db.query`
      SELECT * FROM users
      WHERE invitation_token = ${dto.token}
        AND invitation_expires_at > NOW()
        AND email_verified = false
    `;

    if (!user) throw new BadRequestException('Invitation token is invalid or has expired.');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    await this.db.query`
      UPDATE users SET
        first_name = ${dto.firstName},
        last_name  = ${dto.lastName},
        password_hash = ${passwordHash},
        email_verified = true,
        invitation_token = NULL,
        invitation_expires_at = NULL,
        requested_company_role = ${dto.requestedRole},
        updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // `user` was SELECTed before the UPDATE above, so its requestedCompanyRole
    // is stale (whatever it was pre-signup, normally null) -- override it
    // explicitly with what this request just set, rather than trusting the
    // pre-update row issueTokens() would otherwise read.
    const updatedUser = {
      ...user,
      firstName: dto.firstName,
      lastName: dto.lastName,
      emailVerified: true,
      requestedCompanyRole: dto.requestedRole,
    };
    const tokens = await this.issueTokens(updatedUser);

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

  // ── Forgot password ───────────────────────────────────────────────────────
  async forgotPassword(email: string): Promise<void> {
    const [user] = await this.db.query`
      SELECT id FROM users WHERE LOWER(email) = LOWER(${email}) AND is_active = true
    `;

    // Always return success — never reveal whether an email exists (enumeration attack prevention)
    if (!user) return;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

    await this.db.query`
      UPDATE users SET
        password_reset_token = ${token},
        password_reset_expires_at = ${expiresAt.toISOString()},
        updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // TODO Phase 2: send email via notification service
    this.logger.log(`Password reset token generated for user ${user.id as string}`);
  }

  // ── Reset password ────────────────────────────────────────────────────────
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const [user] = await this.db.query`
      SELECT id FROM users
      WHERE password_reset_token = ${dto.token}
        AND password_reset_expires_at > NOW()
        AND is_active = true
    `;

    if (!user) throw new BadRequestException('Reset token is invalid or has expired.');

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });

    await this.db.query`
      UPDATE users SET
        password_hash = ${passwordHash},
        password_reset_token = NULL,
        password_reset_expires_at = NULL,
        updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // Revoke all existing refresh tokens — force re-login everywhere
    await this.db.query`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ${user.id}`;
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

    await this.db.query`
      INSERT INTO refresh_tokens (user_id, company_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (${payload.sub}, ${payload.companyId}, ${tokenHash}, ${expiresAt.toISOString()},
              ${ipAddress ?? null}, ${userAgent ?? null})
    `;

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