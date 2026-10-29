import { NotFoundException } from '@nestjs/common';
import { CalendarIntegrationService } from './calendar-integration.service';
import { CredentialEncryptionService } from '../../../common/crypto/credential-encryption.service';
import type { DatabaseService } from '../../../database/database.service';
import type { ConfigService } from '@nestjs/config';
import type { GoogleCalendarClient } from './google-calendar-client';
import { signOAuthState } from './oauth-state.util';

const secret = 'test-jwt-secret';
const companyId = 'company-1';
const userId = 'user-1';

// A real CredentialEncryptionService (not a mock) -- these tests need a
// genuine encrypt/decrypt round trip to verify legacy-vs-encrypted rows are
// actually readable, not just that the right SQL shape was produced. Fixes
// H-4 (KNOWN_ISSUES_AND_REMEDIATION.md): Google Calendar OAuth tokens were
// previously stored in plaintext, unlike email_integrations.
function makeEncryption(): CredentialEncryptionService {
  const config = { get: jest.fn((key: string) => (key === 'app.credentialEncryptionKey' ? 'a'.repeat(32) : undefined)) };
  return new CredentialEncryptionService(config as unknown as ConfigService);
}

function makeService(sqlMock: jest.Mock, googleClientOverrides: Partial<GoogleCalendarClient> = {}, encryption = makeEncryption()) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  const config = { get: jest.fn((key: string) => (key === 'jwt.accessSecret' ? secret : undefined)) };
  const googleClient = {
    buildAuthorizeUrl: jest.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?mock=1'),
    exchangeCodeForTokens: jest.fn(),
    refreshAccessToken: jest.fn(),
    listEvents: jest.fn(),
    ...googleClientOverrides,
  };
  const svc = new CalendarIntegrationService(
    db as unknown as DatabaseService,
    config as unknown as ConfigService,
    googleClient as unknown as GoogleCalendarClient,
    encryption,
  );
  return { svc, db, googleClient, encryption };
}

// A row shaped like a pre-migration-077 legacy write: only the plaintext
// columns populated, every ciphertext/iv/auth-tag column NULL.
function legacyRow(accessToken: string, refreshToken: string, tokenExpiresAt: string) {
  return {
    userId, accessToken, refreshToken, tokenExpiresAt,
    accessTokenCiphertext: null, accessTokenIv: null, accessTokenAuthTag: null,
    refreshTokenCiphertext: null, refreshTokenIv: null, refreshTokenAuthTag: null,
  };
}

// A row shaped like a post-migration write: plaintext columns NULL, real
// ciphertext present.
function encryptedRow(encryption: CredentialEncryptionService, accessToken: string, refreshToken: string, tokenExpiresAt: string) {
  const access = encryption.encrypt(accessToken);
  const refresh = encryption.encrypt(refreshToken);
  return {
    userId, accessToken: null, refreshToken: null, tokenExpiresAt,
    accessTokenCiphertext: access.ciphertext, accessTokenIv: access.iv, accessTokenAuthTag: access.authTag,
    refreshTokenCiphertext: refresh.ciphertext, refreshTokenIv: refresh.iv, refreshTokenAuthTag: refresh.authTag,
  };
}

describe('CalendarIntegrationService.getAuthorizeUrl', () => {
  it('signs a state token and passes it to the Google client', () => {
    const { svc, googleClient } = makeService(jest.fn());
    const url = svc.getAuthorizeUrl(companyId, userId);

    expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?mock=1');
    expect(googleClient.buildAuthorizeUrl).toHaveBeenCalledWith(expect.any(String));
  });
});

describe('CalendarIntegrationService.handleCallback', () => {
  it('rejects a state signed with a different secret before ever calling Google', async () => {
    const { svc, googleClient } = makeService(jest.fn());
    const badState = signOAuthState('wrong-secret', companyId, userId);

    await expect(svc.handleCallback('some-code', badState)).rejects.toThrow('Invalid OAuth state signature');
    expect(googleClient.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('refuses to store a connection when Google returns no refresh token', async () => {
    const sqlMock = jest.fn();
    const state = signOAuthState(secret, companyId, userId);
    const { svc } = makeService(sqlMock, {
      exchangeCodeForTokens: jest.fn().mockResolvedValue({ accessToken: 'access-1', expiresAt: '2026-01-01T01:00:00.000Z' }),
    });

    await expect(svc.handleCallback('some-code', state)).rejects.toThrow('Google did not return a refresh token');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  // Initial authorization (H-4 fix): the very first write for a new
  // connection must go out encrypted, never as plaintext.
  it('upserts the integration with encrypted tokens, never plaintext, and returns the verified companyId', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const state = signOAuthState(secret, companyId, userId);
    const { svc } = makeService(sqlMock, {
      exchangeCodeForTokens: jest.fn().mockResolvedValue({
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2026-01-01T01:00:00.000Z',
      }),
    });

    const result = await svc.handleCallback('some-code', state);
    expect(result).toEqual({ companyId });

    const insertCall = sqlMock.mock.calls[0];
    const insertQueryText = (insertCall[0] as string[]).join('');
    const insertValues = insertCall.slice(1) as unknown[];
    expect(insertQueryText).toContain('ON CONFLICT (user_id, provider)');
    expect(insertQueryText).toContain('access_token_ciphertext');
    expect(insertQueryText).toContain('access_token = NULL');
    expect(insertQueryText).toContain('refresh_token = NULL');
    // The raw plaintext token values must never appear anywhere in the
    // bound parameters sent to the database.
    expect(insertValues).not.toContain('access-1');
    expect(insertValues).not.toContain('refresh-1');
  });
});

describe('CalendarIntegrationService.getStatus', () => {
  it('reports not connected when no row exists', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    const status = await svc.getStatus(companyId, userId);
    expect(status).toEqual({ connected: false, connectedAt: null, lastUsedAt: null });
  });

  it('reports connected with timestamps when a row exists', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([{ connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-02T00:00:00.000Z' }]);
    const { svc } = makeService(sqlMock);

    const status = await svc.getStatus(companyId, userId);
    expect(status).toEqual({ connected: true, connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-02T00:00:00.000Z' });
  });
});

describe('CalendarIntegrationService.getTodayEvents', () => {
  it('throws NotFoundException when the user has no connected calendar', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // integration lookup -> none
    const { svc } = makeService(sqlMock);

    await expect(svc.getTodayEvents(companyId, userId)).rejects.toThrow(NotFoundException);
  });

  it('reuses a still-valid access token without refreshing (encrypted row)', async () => {
    const encryption = makeEncryption();
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([encryptedRow(encryption, 'access-1', 'refresh-1', farFuture)]) // integration lookup
      .mockResolvedValueOnce([]); // last_used_at update
    const { svc, googleClient } = makeService(sqlMock, {
      listEvents: jest.fn().mockResolvedValue([{ id: 'evt-1', title: 'Standup', startTime: '2026-01-01T09:00:00.000Z', endTime: '2026-01-01T09:15:00.000Z' }]),
    }, encryption);

    const events = await svc.getTodayEvents(companyId, userId);

    expect(events).toHaveLength(1);
    expect(googleClient.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleClient.listEvents).toHaveBeenCalledWith('access-1', expect.any(String), expect.any(String));
  });

  // Legacy-row transition: a row written before migration 077 (plaintext
  // columns only) must still be usable for a read that doesn't need a
  // refresh -- decryptOrLegacy falls back to the plaintext column.
  it('reads a legacy plaintext-only row correctly when the access token is still valid', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([legacyRow('legacy-access', 'legacy-refresh', farFuture)])
      .mockResolvedValueOnce([]);
    const { svc, googleClient } = makeService(sqlMock, {
      listEvents: jest.fn().mockResolvedValue([]),
    });

    await svc.getTodayEvents(companyId, userId);

    expect(googleClient.listEvents).toHaveBeenCalledWith('legacy-access', expect.any(String), expect.any(String));
  });

  it('refreshes an expired access token before fetching events, and persists the refreshed token encrypted', async () => {
    const encryption = makeEncryption();
    const alreadyExpired = new Date(Date.now() - 60 * 1000).toISOString();
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([encryptedRow(encryption, 'stale-access', 'refresh-1', alreadyExpired)]) // integration lookup
      .mockResolvedValueOnce([]) // UPDATE access_token
      .mockResolvedValueOnce([]); // last_used_at update
    const { svc, googleClient } = makeService(sqlMock, {
      refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh-access', expiresAt: '2026-01-01T02:00:00.000Z' }),
      listEvents: jest.fn().mockResolvedValue([]),
    }, encryption);

    await svc.getTodayEvents(companyId, userId);

    expect(googleClient.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    expect(googleClient.listEvents).toHaveBeenCalledWith('fresh-access', expect.any(String), expect.any(String));

    const refreshUpdateCall = sqlMock.mock.calls[1];
    const refreshUpdateQueryText = (refreshUpdateCall[0] as string[]).join('');
    const refreshUpdateValues = refreshUpdateCall.slice(1) as unknown[];
    expect(refreshUpdateQueryText).toContain('access_token = NULL');
    expect(refreshUpdateQueryText).toContain('access_token_ciphertext');
    expect(refreshUpdateQueryText).toContain('refresh_token_ciphertext');
    // Neither the fresh nor the refresh-flow token value is ever a bound
    // parameter in plaintext -- only their encrypted ciphertext/iv/tag are.
    expect(refreshUpdateValues).not.toContain('fresh-access');
    expect(refreshUpdateValues).not.toContain('refresh-1');
  });

  // Legacy-row transition, full path: a legacy plaintext row that needs a
  // refresh gets fully migrated onto the encrypted columns by that same
  // refresh (opportunistic migration, see ensureFreshAccessToken's comment).
  it('migrates a legacy plaintext row onto encrypted columns the next time it refreshes', async () => {
    const alreadyExpired = new Date(Date.now() - 60 * 1000).toISOString();
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([legacyRow('legacy-stale-access', 'legacy-refresh', alreadyExpired)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { svc, googleClient } = makeService(sqlMock, {
      refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh-access', expiresAt: '2026-01-01T02:00:00.000Z' }),
      listEvents: jest.fn().mockResolvedValue([]),
    });

    await svc.getTodayEvents(companyId, userId);

    expect(googleClient.refreshAccessToken).toHaveBeenCalledWith('legacy-refresh');
    const refreshUpdateQueryText = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(refreshUpdateQueryText).toContain('access_token = NULL');
    expect(refreshUpdateQueryText).toContain('refresh_token = NULL');
  });

  // Failure handling: a tampered/corrupted ciphertext must fail loudly
  // (AES-GCM auth-tag mismatch) rather than silently return garbage, and
  // the thrown error must not echo the ciphertext or any token value.
  it('throws without leaking token data when a row is encrypted but the ciphertext has been tampered with', async () => {
    const encryption = makeEncryption();
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const row = encryptedRow(encryption, 'access-1', 'refresh-1', farFuture);
    row.accessTokenCiphertext = Buffer.from('tampered-ciphertext').toString('base64');
    const sqlMock = jest.fn().mockResolvedValueOnce([row]);
    const { svc } = makeService(sqlMock, {}, encryption);

    await expect(svc.getTodayEvents(companyId, userId)).rejects.not.toThrow(/access-1|refresh-1/);
  });

  // Failure handling: a row with neither a legacy value nor ciphertext for
  // a slot (shouldn't happen via this service's own writes, but defensive
  // against a hand-edited or corrupted row) fails clearly instead of
  // silently passing `null`/`undefined` through to the Google API client.
  it('throws a clear error when a row has no usable token in a slot', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sqlMock = jest.fn().mockResolvedValueOnce([{
      userId, accessToken: null, refreshToken: 'refresh-1', tokenExpiresAt: farFuture,
      accessTokenCiphertext: null, accessTokenIv: null, accessTokenAuthTag: null,
      refreshTokenCiphertext: null, refreshTokenIv: null, refreshTokenAuthTag: null,
    }]);
    const { svc } = makeService(sqlMock);

    await expect(svc.getTodayEvents(companyId, userId)).rejects.toThrow(/no usable access token/);
  });
});

// Key errors: CredentialEncryptionService itself refuses to construct
// without a real >=32-char CREDENTIAL_ENCRYPTION_KEY (app.config.ts's
// requireStrongSecret(), exercised by credential-encryption.service.spec.ts)
// -- the whole process fails to boot before this service could ever be
// instantiated with a bad key, so there is no separate "key error at
// runtime" state for this service to handle.

describe('CalendarIntegrationService.disconnect', () => {
  it('deletes the integration row', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    await svc.disconnect(companyId, userId);
    const deleteQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(deleteQueryText).toContain('DELETE FROM workforce_calendar_integrations');
  });
});
