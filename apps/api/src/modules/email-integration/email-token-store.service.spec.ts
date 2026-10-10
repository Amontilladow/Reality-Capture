import type { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service';
import { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import { EmailTokenStore } from './email-token-store.service';

const companyId = 'company-1';
const userId = 'user-1';

function makeStore(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  const config = { get: jest.fn().mockReturnValue('a-real-encryption-key') } as unknown as ConfigService;
  const encryption = new CredentialEncryptionService(config);
  const store = new EmailTokenStore(db as unknown as DatabaseService, encryption);
  return { store, db, sqlMock };
}

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2026-01-01T01:00:00.000Z', grantedScopes: 'Mail.Send' };

describe('EmailTokenStore.upsert', () => {
  it('encrypts both tokens before they ever reach SQL', async () => {
    const { store, sqlMock } = makeStore(jest.fn().mockResolvedValueOnce([]));
    await store.upsert(companyId, userId, 'microsoft', 'user@company.com', tokens);

    const insertQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(insertQueryText).toContain('ON CONFLICT (user_id, provider)');
    // The raw plaintext access/refresh tokens must never appear anywhere in
    // the values bound to the query -- only their encrypted form should.
    const boundValues = sqlMock.mock.calls[0].slice(1).flat();
    expect(boundValues).not.toContain('access-1');
    expect(boundValues).not.toContain('refresh-1');
  });
});

describe('EmailTokenStore.getDecrypted', () => {
  it('round-trips a stored connection back to its original plaintext tokens', async () => {
    const { store, sqlMock } = makeStore(jest.fn());
    // Encrypt with a separate instance (same key) to build a realistic stored row, then feed it through getDecrypted.
    const config = { get: jest.fn().mockReturnValue('a-real-encryption-key') } as unknown as ConfigService;
    const encryption = new CredentialEncryptionService(config);
    const access = encryption.encrypt('access-1');
    const refresh = encryption.encrypt('refresh-1');

    sqlMock.mockResolvedValueOnce([{
      userId, connectedEmail: 'user@company.com', tokenExpiresAt: '2026-01-01T01:00:00.000Z',
      accessTokenCiphertext: access.ciphertext, accessTokenIv: access.iv, accessTokenAuthTag: access.authTag,
      refreshTokenCiphertext: refresh.ciphertext, refreshTokenIv: refresh.iv, refreshTokenAuthTag: refresh.authTag,
    }]);

    const result = await store.getDecrypted(companyId, userId, 'microsoft');
    expect(result).toEqual({
      userId, connectedEmail: 'user@company.com', accessToken: 'access-1', refreshToken: 'refresh-1',
      tokenExpiresAt: '2026-01-01T01:00:00.000Z',
    });
  });

  it('returns null when no connection exists', async () => {
    const { store } = makeStore(jest.fn().mockResolvedValueOnce([]));
    expect(await store.getDecrypted(companyId, userId, 'google')).toBeNull();
  });
});

describe('EmailTokenStore.getStatus', () => {
  it('reports not_connected when no row exists', async () => {
    const { store } = makeStore(jest.fn().mockResolvedValueOnce([]));
    const status = await store.getStatus(companyId, userId, 'microsoft');
    expect(status).toEqual({ provider: 'microsoft', status: 'not_connected', connectedEmail: null, connectedAt: null, lastUsedAt: null, lastErrorMessage: null });
  });

  it('reports connected when the token has not expired and no error is recorded', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { store } = makeStore(jest.fn().mockResolvedValueOnce([{
      connectedEmail: 'user@company.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null,
      tokenExpiresAt: farFuture, lastErrorCode: null, lastErrorAt: null,
    }]));
    const status = await store.getStatus(companyId, userId, 'google');
    expect(status.status).toBe('connected');
    expect(status.connectedEmail).toBe('user@company.com');
  });

  it('reports connection_expired when the token is past expiry with no recorded error', async () => {
    const alreadyExpired = new Date(Date.now() - 60 * 1000).toISOString();
    const { store } = makeStore(jest.fn().mockResolvedValueOnce([{
      connectedEmail: 'user@company.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null,
      tokenExpiresAt: alreadyExpired, lastErrorCode: null, lastErrorAt: null,
    }]));
    const status = await store.getStatus(companyId, userId, 'google');
    expect(status.status).toBe('connection_expired');
  });

  it('reports authorization_required when the last error was a revoked grant', async () => {
    const { store } = makeStore(jest.fn().mockResolvedValueOnce([{
      connectedEmail: 'user@company.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null,
      tokenExpiresAt: '2026-01-01T01:00:00.000Z', lastErrorCode: 'invalid_grant', lastErrorAt: '2026-01-01T02:00:00.000Z',
    }]));
    const status = await store.getStatus(companyId, userId, 'microsoft');
    expect(status.status).toBe('authorization_required');
    expect(status.lastErrorMessage).toContain('revoked');
  });

  it('reports error for any other recorded failure', async () => {
    const { store } = makeStore(jest.fn().mockResolvedValueOnce([{
      connectedEmail: 'user@company.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null,
      tokenExpiresAt: '2026-01-01T01:00:00.000Z', lastErrorCode: 'server_error', lastErrorAt: '2026-01-01T02:00:00.000Z',
    }]));
    const status = await store.getStatus(companyId, userId, 'microsoft');
    expect(status.status).toBe('error');
  });
});

describe('EmailTokenStore.disconnect', () => {
  it('deletes only the calling user\'s own row for that provider', async () => {
    const { store, sqlMock } = makeStore(jest.fn().mockResolvedValueOnce([]));
    await store.disconnect(companyId, userId, 'microsoft');
    const deleteQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(deleteQueryText).toContain('DELETE FROM email_integrations');
    expect(sqlMock.mock.calls[0]).toContain(userId);
  });
});

describe('EmailTokenStore.recordError / touchLastUsed', () => {
  it('recordError updates the error fields without touching tokens', async () => {
    const { store, sqlMock } = makeStore(jest.fn().mockResolvedValueOnce([]));
    await store.recordError(companyId, userId, 'google', 'invalid_grant');
    const updateQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(updateQueryText).toContain('last_error_code');
  });

  it('touchLastUsed updates last_used_at', async () => {
    const { store, sqlMock } = makeStore(jest.fn().mockResolvedValueOnce([]));
    await store.touchLastUsed(companyId, userId, 'google');
    const updateQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(updateQueryText).toContain('last_used_at');
  });
});
