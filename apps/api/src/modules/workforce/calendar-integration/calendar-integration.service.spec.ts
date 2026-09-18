import { NotFoundException } from '@nestjs/common';
import { CalendarIntegrationService } from './calendar-integration.service';
import type { DatabaseService } from '../../../database/database.service';
import type { ConfigService } from '@nestjs/config';
import type { GoogleCalendarClient } from './google-calendar-client';
import { signOAuthState } from './oauth-state.util';

const secret = 'test-jwt-secret';
const companyId = 'company-1';
const userId = 'user-1';

function makeService(sqlMock: jest.Mock, googleClientOverrides: Partial<GoogleCalendarClient> = {}) {
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
  );
  return { svc, db, googleClient };
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

  it('upserts the integration and returns the verified companyId on success', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const state = signOAuthState(secret, companyId, userId);
    const { svc } = makeService(sqlMock, {
      exchangeCodeForTokens: jest.fn().mockResolvedValue({
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2026-01-01T01:00:00.000Z',
      }),
    });

    const result = await svc.handleCallback('some-code', state);
    expect(result).toEqual({ companyId });
    const insertQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(insertQueryText).toContain('ON CONFLICT (user_id, provider)');
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

  it('reuses a still-valid access token without refreshing', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ userId, accessToken: 'access-1', refreshToken: 'refresh-1', tokenExpiresAt: farFuture }]) // integration lookup
      .mockResolvedValueOnce([]); // last_used_at update
    const { svc, googleClient } = makeService(sqlMock, {
      listEvents: jest.fn().mockResolvedValue([{ id: 'evt-1', title: 'Standup', startTime: '2026-01-01T09:00:00.000Z', endTime: '2026-01-01T09:15:00.000Z' }]),
    });

    const events = await svc.getTodayEvents(companyId, userId);

    expect(events).toHaveLength(1);
    expect(googleClient.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleClient.listEvents).toHaveBeenCalledWith('access-1', expect.any(String), expect.any(String));
  });

  it('refreshes an expired access token before fetching events, and persists the refreshed token', async () => {
    const alreadyExpired = new Date(Date.now() - 60 * 1000).toISOString();
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ userId, accessToken: 'stale-access', refreshToken: 'refresh-1', tokenExpiresAt: alreadyExpired }]) // integration lookup
      .mockResolvedValueOnce([]) // UPDATE access_token
      .mockResolvedValueOnce([]); // last_used_at update
    const { svc, googleClient } = makeService(sqlMock, {
      refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fresh-access', expiresAt: '2026-01-01T02:00:00.000Z' }),
      listEvents: jest.fn().mockResolvedValue([]),
    });

    await svc.getTodayEvents(companyId, userId);

    expect(googleClient.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    expect(googleClient.listEvents).toHaveBeenCalledWith('fresh-access', expect.any(String), expect.any(String));
    const refreshUpdateQueryText = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(refreshUpdateQueryText).toContain('SET access_token');
  });
});

describe('CalendarIntegrationService.disconnect', () => {
  it('deletes the integration row', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc } = makeService(sqlMock);

    await svc.disconnect(companyId, userId);
    const deleteQueryText = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(deleteQueryText).toContain('DELETE FROM workforce_calendar_integrations');
  });
});
