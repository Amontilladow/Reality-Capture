import { BadRequestException } from '@nestjs/common';
import { CalendarIntegrationService } from './calendar-integration.service';
import { CredentialEncryptionService } from '../../../common/crypto/credential-encryption.service';
import type { DatabaseService } from '../../../database/database.service';
import type { ConfigService } from '@nestjs/config';
import type { GoogleCalendarClient } from './google-calendar-client';
import type { OutlookCalendarClient } from './outlook-calendar-client';
import { signOAuthState, verifyOAuthState } from './oauth-state.util';
import { zonedMidnightUtc } from '../../workspace/priority-rules';

// The personal-calendar additions: Outlook as a second provider on the
// same encrypted store, the signed return-to in the OAuth state, and the
// "not configured" refusal.
const secret = 'test-jwt-secret';
const companyId = 'company-1';
const userId = 'user-1';

function encryption() {
  const config = { get: jest.fn((k: string) => (k === 'app.credentialEncryptionKey' ? 'a'.repeat(32) : undefined)) };
  return new CredentialEncryptionService(config as unknown as ConfigService);
}

function make(sqlMock: jest.Mock, opts: { googleConfigured?: boolean; outlookConfigured?: boolean; outlook?: Partial<OutlookCalendarClient> } = {}) {
  const db = { withTenant: jest.fn((_c: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  const config = { get: jest.fn((k: string) => (k === 'jwt.accessSecret' ? secret : undefined)) };
  const google = {
    isConfigured: jest.fn(() => opts.googleConfigured ?? true),
    buildAuthorizeUrl: jest.fn((state: string) => `https://google.example/auth?state=${state}`),
    exchangeCodeForTokens: jest.fn(), refreshAccessToken: jest.fn(), listEvents: jest.fn(), listEventsInRange: jest.fn(),
  };
  const outlook = {
    isConfigured: jest.fn(() => opts.outlookConfigured ?? true),
    buildAuthorizeUrl: jest.fn((state: string) => `https://login.microsoftonline.example/auth?state=${state}`),
    exchangeCodeForTokens: jest.fn(), refreshAccessToken: jest.fn(), listEventsInRange: jest.fn(),
    ...opts.outlook,
  };
  const enc = encryption();
  const svc = new CalendarIntegrationService(
    db as unknown as DatabaseService, config as unknown as ConfigService,
    google as unknown as GoogleCalendarClient, enc, outlook as unknown as OutlookCalendarClient,
  );
  return { svc, google, outlook, enc };
}

describe('calendar connections', () => {
  it('reports which providers are configured', () => {
    const { svc } = make(jest.fn(), { googleConfigured: true, outlookConfigured: false });
    expect(svc.configuredProviders()).toEqual({ google_calendar: true, outlook_calendar: false });
  });

  it('refuses a calendar connect for a provider with no credentials set up', () => {
    const { svc } = make(jest.fn(), { outlookConfigured: false });
    expect(() => svc.getAuthorizeUrl(companyId, userId, 'outlook_calendar', 'calendar')).toThrow(BadRequestException);
  });

  it('signs where to return in the state, and only from a valid signature', () => {
    const { svc, outlook } = make(jest.fn());
    const url = svc.getAuthorizeUrl(companyId, userId, 'outlook_calendar', 'calendar');
    expect(outlook.buildAuthorizeUrl).toHaveBeenCalled();
    const state = decodeURIComponent(url.split('state=')[1]);
    expect(verifyOAuthState(secret, state)).toMatchObject({ companyId, userId, returnTo: 'calendar' });
    expect(svc.returnToFromState(state)).toBe('calendar');
    // A tampered or missing state falls back to the original Workforce page.
    expect(svc.returnToFromState(state.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBe('workforce');
    expect(svc.returnToFromState(undefined)).toBe('workforce');
    expect(svc.returnToFromState(signOAuthState(secret, companyId, userId))).toBe('workforce');
  });

  it('stores an Outlook connection under its own provider, encrypted', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]);
    const { svc, outlook } = make(sqlMock, {
      outlook: { exchangeCodeForTokens: jest.fn().mockResolvedValue({ accessToken: 'ms-access', refreshToken: 'ms-refresh', expiresAt: '2030-01-01T00:00:00Z' }) },
    });
    await svc.handleCallback('code', signOAuthState(secret, companyId, userId, 'calendar'), 'outlook_calendar');
    expect(outlook.exchangeCodeForTokens).toHaveBeenCalledWith('code');
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain('outlook_calendar');
    expect(values).not.toContain('ms-access');
    expect(values).not.toContain('ms-refresh');
  });

  it('keeps the rotated refresh token Microsoft returns on refresh', async () => {
    const { svc: seed, enc } = make(jest.fn());
    void seed;
    const a = enc.encrypt('old-access');
    const r = enc.encrypt('old-refresh');
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ userId, accessToken: null, refreshToken: null, tokenExpiresAt: '2000-01-01T00:00:00Z',
        accessTokenCiphertext: a.ciphertext, accessTokenIv: a.iv, accessTokenAuthTag: a.authTag,
        refreshTokenCiphertext: r.ciphertext, refreshTokenIv: r.iv, refreshTokenAuthTag: r.authTag }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { svc, outlook } = make(sqlMock, {
      outlook: {
        refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2030-01-01T00:00:00Z' }),
        listEventsInRange: jest.fn().mockResolvedValue([{ id: 'e1', title: 'Site meeting', allDay: false, start: '2026-11-16T06:00:00Z', end: null, url: null, location: null }]),
      },
    });
    // Same key for both instances, so the seeded ciphertext decrypts.
    (svc as unknown as { encryption: CredentialEncryptionService }).encryption = enc;
    const events = await svc.listEvents(companyId, userId, 'outlook_calendar', '2026-11-16T00:00:00Z', '2026-11-17T00:00:00Z');
    expect(events).toHaveLength(1);
    expect(outlook.refreshAccessToken).toHaveBeenCalledWith('old-refresh');
    expect(outlook.listEventsInRange).toHaveBeenCalledWith('new-access', expect.any(String), expect.any(String));
    const update = sqlMock.mock.calls[1];
    const ciphertexts = update.slice(1) as string[];
    // The stored refresh token is the rotated one.
    const stored = enc.decrypt({ ciphertext: ciphertexts[3], iv: ciphertexts[4], authTag: ciphertexts[5] });
    expect(stored).toBe('new-refresh');
  });
});

describe('zonedMidnightUtc', () => {
  it('finds local midnight as a UTC instant, across zones and DST', () => {
    expect(zonedMidnightUtc('2026-11-16', 'Asia/Dubai').toISOString()).toBe('2026-11-15T20:00:00.000Z');
    expect(zonedMidnightUtc('2026-11-16', 'UTC').toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(zonedMidnightUtc('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(zonedMidnightUtc('2026-12-01', 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });
});
