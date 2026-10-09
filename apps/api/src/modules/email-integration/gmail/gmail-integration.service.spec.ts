import type { ConfigService } from '@nestjs/config';
import { GmailIntegrationService } from './gmail-integration.service';
import type { GmailClient } from './gmail-client';
import type { EmailTokenStore } from '../email-token-store.service';
import { signEmailOAuthState } from '../oauth-state.util';

const secret = 'test-jwt-secret';
const companyId = 'company-1';
const userId = 'user-1';

function makeService(clientOverrides: Partial<GmailClient> = {}, storeOverrides: Partial<EmailTokenStore> = {}) {
  const config = { get: jest.fn((key: string) => (key === 'jwt.accessSecret' ? secret : undefined)) } as unknown as ConfigService;
  const client = {
    buildAuthorizeUrl: jest.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?mock=1'),
    exchangeCodeForTokens: jest.fn(),
    refreshAccessToken: jest.fn(),
    ...clientOverrides,
  } as unknown as GmailClient;
  const tokenStore = {
    upsert: jest.fn(),
    getStatus: jest.fn(),
    disconnect: jest.fn(),
    getDecrypted: jest.fn(),
    updateAfterRefresh: jest.fn(),
    recordError: jest.fn(),
    touchLastUsed: jest.fn(),
    ...storeOverrides,
  } as unknown as EmailTokenStore;
  const svc = new GmailIntegrationService(tokenStore, config, client);
  return { svc, client, tokenStore };
}

describe('GmailIntegrationService.getAuthorizeUrl', () => {
  it('signs a google-provider state token and passes it to the Gmail client', () => {
    const { svc, client } = makeService();
    const url = svc.getAuthorizeUrl(companyId, userId);
    expect(url).toContain('accounts.google.com');
    expect(client.buildAuthorizeUrl).toHaveBeenCalledWith(expect.any(String));
  });
});

describe('GmailIntegrationService.handleCallback', () => {
  it('rejects a state signed with a different secret before ever calling Google', async () => {
    const { svc, client } = makeService();
    const badState = signEmailOAuthState('wrong-secret', companyId, userId, 'google');
    await expect(svc.handleCallback('some-code', badState)).rejects.toThrow('Invalid OAuth state signature');
    expect(client.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('rejects a state signed for the microsoft provider (cross-provider replay)', async () => {
    const { svc, client } = makeService();
    const microsoftState = signEmailOAuthState(secret, companyId, userId, 'microsoft');
    await expect(svc.handleCallback('some-code', microsoftState)).rejects.toThrow('OAuth state was issued for a different provider');
    expect(client.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('exchanges the code and upserts the connection on success', async () => {
    const state = signEmailOAuthState(secret, companyId, userId, 'google');
    const { svc, tokenStore } = makeService({
      exchangeCodeForTokens: jest.fn().mockResolvedValue({
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2026-01-01T01:00:00.000Z',
        grantedScopes: 'gmail.send', connectedEmail: 'user@gmail.com',
      }),
    });

    const result = await svc.handleCallback('some-code', state);
    expect(result).toEqual({ companyId });
    expect(tokenStore.upsert).toHaveBeenCalledWith(companyId, userId, 'google', 'user@gmail.com', expect.objectContaining({ accessToken: 'access-1' }));
  });
});

describe('GmailIntegrationService.testConnection', () => {
  it('reports not connected when no integration exists', async () => {
    const { svc } = makeService({}, { getDecrypted: jest.fn().mockResolvedValue(null) });
    const result = await svc.testConnection(companyId, userId);
    expect(result).toEqual({ ok: false, error: 'Not connected.' });
  });

  it('refreshes the token and reports success when the connection is still valid', async () => {
    const { svc, tokenStore } = makeService(
      { refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh', expiresAt: '2026-01-01T02:00:00.000Z', grantedScopes: 'gmail.send' }) },
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@gmail.com', accessToken: 'stale', refreshToken: 'refresh-1', tokenExpiresAt: '2026-01-01T00:00:00.000Z' }) },
    );

    const result = await svc.testConnection(companyId, userId);
    expect(result).toEqual({ ok: true });
    expect(tokenStore.updateAfterRefresh).toHaveBeenCalled();
    expect(tokenStore.touchLastUsed).toHaveBeenCalled();
  });

  it('records an error and reports failure when the refresh is rejected (revoked consent)', async () => {
    const { svc, tokenStore } = makeService(
      { refreshAccessToken: jest.fn().mockRejectedValue(new Error('invalid_grant')) },
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@gmail.com', accessToken: 'stale', refreshToken: 'refresh-1', tokenExpiresAt: '2026-01-01T00:00:00.000Z' }) },
    );

    const result = await svc.testConnection(companyId, userId);
    expect(result.ok).toBe(false);
    expect(tokenStore.recordError).toHaveBeenCalledWith(companyId, userId, 'google', 'invalid_grant');
  });
});

describe('GmailIntegrationService.disconnect', () => {
  it('delegates to the token store for the calling user only', async () => {
    const { svc, tokenStore } = makeService();
    await svc.disconnect(companyId, userId);
    expect(tokenStore.disconnect).toHaveBeenCalledWith(companyId, userId, 'google');
  });
});

describe('GmailIntegrationService.ensureFreshAccessToken', () => {
  it('returns null when not connected', async () => {
    const { svc } = makeService({}, { getDecrypted: jest.fn().mockResolvedValue(null) });
    expect(await svc.ensureFreshAccessToken(companyId, userId)).toBeNull();
  });

  it('reuses a still-valid access token without refreshing', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { svc, client } = makeService(
      {},
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@gmail.com', accessToken: 'access-1', refreshToken: 'refresh-1', tokenExpiresAt: farFuture }) },
    );
    const token = await svc.ensureFreshAccessToken(companyId, userId);
    expect(token).toBe('access-1');
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes an expired access token and persists it', async () => {
    const alreadyExpired = new Date(Date.now() - 60 * 1000).toISOString();
    const { svc, tokenStore } = makeService(
      { refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh', expiresAt: '2026-01-01T02:00:00.000Z', grantedScopes: 'gmail.send' }) },
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@gmail.com', accessToken: 'stale', refreshToken: 'refresh-1', tokenExpiresAt: alreadyExpired }) },
    );
    const token = await svc.ensureFreshAccessToken(companyId, userId);
    expect(token).toBe('fresh');
    expect(tokenStore.updateAfterRefresh).toHaveBeenCalled();
  });
});
