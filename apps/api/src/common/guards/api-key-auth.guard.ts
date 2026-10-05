import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from '../../database/database.service';

// Public API auth: a second, independent credential type alongside the JWT
// cookie/bearer flow everything else in this app uses. Deliberately NOT
// wired into the global APP_GUARD chain in app.module.ts -- the public-api
// module's controller is @Public() (so JwtAuthGuard/TenancyGuard/RolesGuard/
// ProjectPermissionGuard all no-op on it, same as the progress-report share
// links) and applies this guard itself via @UseGuards(). There's no
// AuthenticatedUser for an API-key request, so this populates
// request.apiKeyContext instead, read via the parallel @CurrentApiKey().
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = request.headers['x-api-key'] as string | undefined;
    if (!rawKey) {
      throw new UnauthorizedException({ code: 'API_KEY_MISSING', message: 'Provide an API key via the X-API-Key header.' });
    }

    // Same SHA-256-of-the-raw-secret lookup as refresh_tokens
    // (auth.service.ts hashToken()) -- an O(1) indexed equality check, not a
    // per-row verify, since this runs on every inbound Public API request.
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    // withSystemBypass required -- the tenant (company_id) isn't known yet;
    // it's exactly what this lookup resolves. Same bootstrap category as
    // auth.service.ts's login-by-email lookup.
    const [key] = await this.db.withSystemBypass(sql => sql`
      SELECT id, company_id, scopes FROM api_keys
      WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    `);
    if (!key) {
      throw new UnauthorizedException({ code: 'API_KEY_INVALID', message: 'This API key is invalid or has been revoked.' });
    }

    // Best-effort usage tracking -- never block/fail the request over it.
    this.db.withTenant(key.companyId as string, sql => sql`
      UPDATE api_keys SET last_used_at = NOW() WHERE id = ${key.id}
    `).catch(() => undefined);

    request.apiKeyContext = { apiKeyId: key.id, companyId: key.companyId, scopes: key.scopes };
    return true;
  }
}
