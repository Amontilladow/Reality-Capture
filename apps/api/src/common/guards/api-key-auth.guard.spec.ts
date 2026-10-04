import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import type { DatabaseService } from '../../database/database.service';

function makeContext(headers: Record<string, string>) {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as Parameters<ApiKeyAuthGuard['canActivate']>[0];
}

describe('ApiKeyAuthGuard', () => {
  it('rejects a request with no X-API-Key header', async () => {
    const db = { withSystemBypass: jest.fn(), withTenant: jest.fn() };
    const guard = new ApiKeyAuthGuard(db as unknown as DatabaseService);
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(UnauthorizedException);
    expect(db.withSystemBypass).not.toHaveBeenCalled();
  });

  it('rejects a key whose hash matches no row (invalid or revoked)', async () => {
    const db = { withSystemBypass: jest.fn().mockResolvedValue([]), withTenant: jest.fn() };
    const guard = new ApiKeyAuthGuard(db as unknown as DatabaseService);
    await expect(guard.canActivate(makeContext({ 'x-api-key': 'rc_live_bogus' }))).rejects.toThrow(UnauthorizedException);
  });

  it('looks up by SHA-256 of the raw key, never the raw key itself, and attaches apiKeyContext on success', async () => {
    const rawKey = 'rc_live_abcdef0123456789';
    const expectedHash = createHash('sha256').update(rawKey).digest('hex');

    const withSystemBypass = jest.fn(async (fn: (sql: unknown) => unknown) => {
      const fakeSql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
        // The lookup must filter on the hash, not the raw secret.
        expect(values).toContain(expectedHash);
        expect(values).not.toContain(rawKey);
        return [{ id: 'key-1', companyId: 'company-1', scopes: ['read'] }];
      };
      return fn(fakeSql);
    });
    const withTenant = jest.fn().mockResolvedValue(undefined);
    const db = { withSystemBypass, withTenant };
    const guard = new ApiKeyAuthGuard(db as unknown as DatabaseService);

    const context = makeContext({ 'x-api-key': rawKey });
    const request = context.switchToHttp().getRequest() as unknown as { apiKeyContext?: unknown };

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.apiKeyContext).toEqual({ apiKeyId: 'key-1', companyId: 'company-1', scopes: ['read'] });
  });

  it('never blocks the request if the best-effort last_used_at update fails', async () => {
    const withSystemBypass = jest.fn().mockResolvedValue([{ id: 'key-1', companyId: 'company-1', scopes: ['read'] }]);
    const withTenant = jest.fn().mockRejectedValue(new Error('connection reset'));
    const db = { withSystemBypass, withTenant };
    const guard = new ApiKeyAuthGuard(db as unknown as DatabaseService);

    await expect(guard.canActivate(makeContext({ 'x-api-key': 'rc_live_x' }))).resolves.toBe(true);
  });
});
