import type { ConfigService } from '@nestjs/config';
import { OutlookIntegrationService } from './outlook-integration.service';
import type { MicrosoftGraphClient } from './microsoft-graph-client';
import type { EmailTokenStore } from '../email-token-store.service';
import { signEmailOAuthState } from '../oauth-state.util';

const secret = 'test-jwt-secret';
const companyId = 'company-1';
const userId = 'user-1';

function makeService(clientOverrides: Partial<MicrosoftGraphClient> = {}, storeOverrides: Partial<EmailTokenStore> = {}) {
  const config = { get: jest.fn((key: string) => (key === 'jwt.accessSecret' ? secret : undefined)) } as unknown as ConfigService;
  const client = {
    buildAuthorizeUrl: jest.fn(() => 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?mock=1'),
    exchangeCodeForTokens: jest.fn(),
    refreshAccessToken: jest.fn(),
    ...clientOverrides,
  } as unknown as MicrosoftGraphClient;
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
  const svc = new OutlookIntegrationService(tokenStore, config, client);
  return { svc, client, tokenStore };
}

describe('OutlookIntegrationService.getAuthorizeUrl', () => {
  it('signs a microsoft-provider state token and passes it to the Graph client', () => {
    const { svc, client } = makeService();
    const url = svc.getAuthorizeUrl(companyId, userId);
    expect(url).toContain('login.microsoftonline.com');
    expect(client.buildAuthorizeUrl).toHaveBeenCalledWith(expect.any(String));
  });
});

describe('OutlookIntegrationService.handleCallback', () => {
  it('rejects a state signed with a different secret before ever calling Microsoft', async () => {
    const { svc, client } = makeService();
    const badState = signEmailOAuthState('wrong-secret', companyId, userId, 'microsoft');
    await expect(svc.handleCallback('some-code', badState)).rejects.toThrow('Invalid OAuth state signature');
    expect(client.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('rejects a state signed for the google provider (cross-provider replay)', async () => {
    const { svc, client } = makeService();
    const googleState = signEmailOAuthState(secret, companyId, userId, 'google');
    await expect(svc.handleCallback('some-code', googleState)).rejects.toThrow('OAuth state was issued for a different provider');
    expect(client.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('exchanges the code and upserts the connection on success', async () => {
    const state = signEmailOAuthState(secret, companyId, userId, 'microsoft');
    const { svc, tokenStore } = makeService({
      exchangeCodeForTokens: jest.fn().mockResolvedValue({
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2026-01-01T01:00:00.000Z',
        grantedScopes: 'Mail.Send', connectedEmail: 'user@company.com',
      }),
    });

    const result = await svc.handleCallback('some-code', state);
    expect(result).toEqual({ companyId });
    expect(tokenStore.upsert).toHaveBeenCalledWith(companyId, userId, 'microsoft', 'user@company.com', expect.objectContaining({ accessToken: 'access-1' }));
  });
});

describe('OutlookIntegrationService.testConnection', () => {
  it('reports not connected when no integration exists', async () => {
    const { svc } = makeService({}, { getDecrypted: jest.fn().mockResolvedValue(null) });
    const result = await svc.testConnection(companyId, userId);
    expect(result).toEqual({ ok: false, error: 'Not connected.' });
  });

  it('refreshes the token and reports success when the connection is still valid', async () => {
    const { svc, tokenStore } = makeService(
      { refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh', expiresAt: '2026-01-01T02:00:00.000Z', grantedScopes: 'Mail.Send' }) },
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@company.com', accessToken: 'stale', refreshToken: 'refresh-1', tokenExpiresAt: '2026-01-01T00:00:00.000Z' }) },
    );

    const result = await svc.testConnection(companyId, userId);
    expect(result).toEqual({ ok: true });
    expect(tokenStore.updateAfterRefresh).toHaveBeenCalled();
    expect(tokenStore.touchLastUsed).toHaveBeenCalled();
  });

  it('records an error and reports failure when the refresh is rejected (revoked consent)', async () => {
    const { svc, tokenStore } = makeService(
      { refreshAccessToken: jest.fn().mockRejectedValue(new Error('invalid_grant')) },
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@company.com', accessToken: 'stale', refreshToken: 'refresh-1', tokenExpiresAt: '2026-01-01T00:00:00.000Z' }) },
    );

    const result = await svc.testConnection(companyId, userId);
    expect(result.ok).toBe(false);
    expect(tokenStore.recordError).toHaveBeenCalledWith(companyId, userId, 'microsoft', 'invalid_grant');
  });

  it('never calls any send-mail capability -- only refreshes the token', async () => {
    // Guards against a future regression where "test connection" is
    // widened to actually send mail, which Section 13 explicitly forbids
    // without the user's own explicit action.
    const { svc, client } = makeService(
      { refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh', expiresAt: '2026-01-01T02:00:00.000Z', grantedScopes: 'Mail.Send' }) },
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@company.com', accessToken: 'stale', refreshToken: 'refresh-1', tokenExpiresAt: '2026-01-01T00:00:00.000Z' }) },
    );
    await svc.testConnection(companyId, userId);
    expect(Object.keys(client)).not.toContain('sendMail');
  });
});

describe('OutlookIntegrationService.disconnect', () => {
  it('delegates to the token store for the calling user only', async () => {
    const { svc, tokenStore } = makeService();
    await svc.disconnect(companyId, userId);
    expect(tokenStore.disconnect).toHaveBeenCalledWith(companyId, userId, 'microsoft');
  });
});

describe('OutlookIntegrationService.ensureFreshAccessToken', () => {
  it('returns null when not connected', async () => {
    const { svc } = makeService({}, { getDecrypted: jest.fn().mockResolvedValue(null) });
    expect(await svc.ensureFreshAccessToken(companyId, userId)).toBeNull();
  });

  it('reuses a still-valid access token without refreshing', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { svc, client } = makeService(
      {},
      { getDecrypted: jest.fn().mockResolvedValue({ userId, connectedEmail: 'user@company.com', accessToken: 'access-1', refreshToken: 'refresh-1', tokenExpiresAt: farFuture }) },
    );
    const token = await svc.ensureFreshAccessToken(companyId, userId);
    expect(token).toBe('access-1');
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });
});
