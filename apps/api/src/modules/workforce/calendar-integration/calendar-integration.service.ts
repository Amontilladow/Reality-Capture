import { Injectable, NotFoundException, Optional, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../database/database.service';
import { CredentialEncryptionService, type EncryptedCredential } from '../../../common/crypto/credential-encryption.service';
import { GoogleCalendarClient, type CalendarEventSummary, type ExternalCalendarEvent, type GoogleTokens } from './google-calendar-client';
import { OutlookCalendarClient } from './outlook-calendar-client';
import { signOAuthState, verifyOAuthState, type OAuthReturnTo } from './oauth-state.util';

// One row per (user, provider) in workforce_calendar_integrations, tokens
// encrypted. Workforce reads today's Google events; the personal calendar
// (Command Center) reads either provider's events for a date range.
export const CALENDAR_PROVIDERS = ['google_calendar', 'outlook_calendar'] as const;
export type CalendarProvider = typeof CALENDAR_PROVIDERS[number];

interface ProviderClient {
  isConfigured(): boolean;
  buildAuthorizeUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokens>;
  listEventsInRange(accessToken: string, timeMin: string, timeMax: string): Promise<ExternalCalendarEvent[]>;
}

interface IntegrationRow {
  userId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
}

// Raw shape of a SELECT against workforce_calendar_integrations; both the
// legacy plaintext columns and the newer ciphertext/iv/auth-tag triplets
// (migration 077) can be present on any given row, since the migration is
// additive and a row only moves off the plaintext columns the next time it's
// written (handleCallback's reconnect, or ensureFreshAccessToken's refresh).
interface RawIntegrationRow {
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string;
  accessTokenCiphertext: string | null;
  accessTokenIv: string | null;
  accessTokenAuthTag: string | null;
  refreshTokenCiphertext: string | null;
  refreshTokenIv: string | null;
  refreshTokenAuthTag: string | null;
}

@Injectable()
export class CalendarIntegrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly googleClient: GoogleCalendarClient,
    private readonly encryption: CredentialEncryptionService,
    @Optional() private readonly outlookClient?: OutlookCalendarClient,
  ) {}

  private client(provider: CalendarProvider): ProviderClient {
    if (provider === 'outlook_calendar') {
      if (!this.outlookClient) throw new BadRequestException('Outlook calendar is not available');
      return this.outlookClient;
    }
    return this.googleClient;
  }

  /** Which providers this deployment has OAuth credentials for. */
  configuredProviders(): Record<CalendarProvider, boolean> {
    return {
      google_calendar: this.googleClient.isConfigured?.() ?? false,
      outlook_calendar: this.outlookClient?.isConfigured() ?? false,
    };
  }

  private get stateSecret(): string {
    return this.config.get<string>('jwt.accessSecret')!;
  }

  getAuthorizeUrl(companyId: string, userId: string, provider: CalendarProvider = 'google_calendar', returnTo?: OAuthReturnTo): string {
    const client = this.client(provider);
    if (returnTo === 'calendar' && !client.isConfigured()) {
      throw new BadRequestException({ code: 'CALENDAR_PROVIDER_NOT_CONFIGURED', message: 'This calendar provider has not been set up for your organisation yet.' });
    }
    const state = signOAuthState(this.stateSecret, companyId, userId, returnTo);
    return client.buildAuthorizeUrl(state);
  }

  /** Where a callback should send the browser, read from a state we can still verify; else Workforce. */
  returnToFromState(state: string | undefined): OAuthReturnTo {
    if (!state) return 'workforce';
    try {
      return verifyOAuthState(this.stateSecret, state).returnTo ?? 'workforce';
    } catch {
      return 'workforce';
    }
  }

  // Verifies `state` (see oauth-state.util.ts's own comment for why this
  // needs no database lookup to identify who initiated the flow), then
  // exchanges the code and stores the resulting tokens. Throws on any
  // failure; the controller decides what that means for the redirect the
  // user's browser ends up at, this service only ever deals in success or
  // a thrown error, never a partial/ambiguous state.
  async handleCallback(code: string, state: string, provider: CalendarProvider = 'google_calendar'): Promise<{ companyId: string }> {
    const { companyId, userId } = verifyOAuthState(this.stateSecret, state);
    const tokens = await this.client(provider).exchangeCodeForTokens(code);
    const refreshToken = tokens.refreshToken;

    if (!refreshToken) {
      // Google only omits this on a rare re-consent edge case where
      // `prompt=consent` didn't force a fresh grant. Refuse rather than
      // store a connection with no way to refresh past the short-lived
      // access token.
      throw new Error(`${provider === 'outlook_calendar' ? 'Microsoft' : 'Google'} did not return a refresh token for this connection.`);
    }

    const access = this.encryption.encrypt(tokens.accessToken);
    const refresh = this.encryption.encrypt(refreshToken);

    // access_token/refresh_token (the legacy plaintext columns) are
    // deliberately left out of both the INSERT's column list and the
    // ON CONFLICT UPDATE; a brand-new connection never writes plaintext,
    // and a reconnect of a previously-plaintext row clears those columns
    // back to NULL (nothing lists them, so Postgres leaves/sets them to
    // their default, NULL) as part of migrating that row onto the
    // encrypted columns. See migration 077 for why this is safe.
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO workforce_calendar_integrations (
        company_id, user_id, provider,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
        token_expires_at, connected_by
      )
      VALUES (
        ${companyId}, ${userId}, ${provider},
        ${access.ciphertext}, ${access.iv}, ${access.authTag},
        ${refresh.ciphertext}, ${refresh.iv}, ${refresh.authTag},
        ${tokens.expiresAt}, ${userId}
      )
      ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token = NULL,
        refresh_token = NULL,
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        access_token_iv = EXCLUDED.access_token_iv,
        access_token_auth_tag = EXCLUDED.access_token_auth_tag,
        refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
        refresh_token_iv = EXCLUDED.refresh_token_iv,
        refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
        token_expires_at = EXCLUDED.token_expires_at,
        connected_at = NOW(),
        connected_by = EXCLUDED.connected_by,
        updated_at = NOW()`);

    return { companyId };
  }

  async getStatus(companyId: string, userId: string, provider: CalendarProvider = 'google_calendar') {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT connected_at, last_used_at FROM workforce_calendar_integrations
      WHERE user_id = ${userId} AND provider = ${provider}`);
    return {
      connected: !!row,
      connectedAt: (row?.connectedAt as string | undefined) ?? null,
      lastUsedAt: (row?.lastUsedAt as string | undefined) ?? null,
    };
  }

  async disconnect(companyId: string, userId: string, provider: CalendarProvider = 'google_calendar'): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      DELETE FROM workforce_calendar_integrations WHERE user_id = ${userId} AND provider = ${provider}`);
  }

  /** The user's own events between two instants, from one provider. Read live, never stored. */
  async listEvents(companyId: string, userId: string, provider: CalendarProvider, timeMin: string, timeMax: string): Promise<ExternalCalendarEvent[]> {
    const integration = await this.getIntegrationRow(companyId, userId, provider);
    if (!integration) throw new NotFoundException({ code: 'CALENDAR_NOT_CONNECTED', message: 'This calendar is not connected.' });
    const accessToken = await this.ensureFreshAccessToken(companyId, integration, provider);
    const events = await this.client(provider).listEventsInRange(accessToken, timeMin, timeMax);
    await this.db.withTenant(companyId, sql => sql`
      UPDATE workforce_calendar_integrations SET last_used_at = NOW() WHERE user_id = ${userId} AND provider = ${provider}`);
    return events;
  }

  async getTodayEvents(companyId: string, userId: string): Promise<CalendarEventSummary[]> {
    const integration = await this.getIntegrationRow(companyId, userId);
    if (!integration) {
      throw new NotFoundException({ code: 'CALENDAR_NOT_CONNECTED', message: 'Google Calendar is not connected for this user.' });
    }

    const accessToken = await this.ensureFreshAccessToken(companyId, integration);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const events = await this.googleClient.listEvents(accessToken, startOfDay, endOfDay);

    await this.db.withTenant(companyId, sql => sql`
      UPDATE workforce_calendar_integrations SET last_used_at = NOW() WHERE user_id = ${userId} AND provider = 'google_calendar'`);

    return events;
  }

  private async getIntegrationRow(companyId: string, userId: string, provider: CalendarProvider = 'google_calendar'): Promise<IntegrationRow | undefined> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT user_id, access_token, refresh_token, token_expires_at,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
      FROM workforce_calendar_integrations
      WHERE user_id = ${userId} AND provider = ${provider}`);
    if (!row) return undefined;
    const typed = row as unknown as RawIntegrationRow;
    return {
      userId: typed.userId,
      accessToken: this.decryptOrLegacy('access', typed.accessToken, typed.accessTokenCiphertext, typed.accessTokenIv, typed.accessTokenAuthTag),
      refreshToken: this.decryptOrLegacy('refresh', typed.refreshToken, typed.refreshTokenCiphertext, typed.refreshTokenIv, typed.refreshTokenAuthTag),
      tokenExpiresAt: typed.tokenExpiresAt,
    };
  }

  // The ciphertext column's presence IS the legacy-vs-encrypted marker
  // (see migration 077's own comment): no separate version flag needed.
  // Never includes the token value itself in a thrown error, only which
  // slot (access/refresh) was unreadable, consistent with this module's
  // "never log token contents" rule.
  private decryptOrLegacy(
    slot: 'access' | 'refresh',
    legacyPlaintext: string | null,
    ciphertext: string | null,
    iv: string | null,
    authTag: string | null,
  ): string {
    if (ciphertext && iv && authTag) {
      return this.encryption.decrypt({ ciphertext, iv, authTag } satisfies EncryptedCredential);
    }
    if (legacyPlaintext) return legacyPlaintext;
    throw new Error(`Calendar integration row has no usable ${slot} token (neither encrypted nor legacy plaintext).`);
  }

  // 60s safety margin against a token expiring mid-request rather than
  // racing the exact expiry instant.
  private async ensureFreshAccessToken(companyId: string, integration: IntegrationRow, provider: CalendarProvider = 'google_calendar'): Promise<string> {
    const expiresAt = new Date(integration.tokenExpiresAt);
    if (expiresAt.getTime() > Date.now() + 60_000) {
      return integration.accessToken;
    }

    const refreshed = await this.client(provider).refreshAccessToken(integration.refreshToken);
    const access = this.encryption.encrypt(refreshed.accessToken);
    // Opportunistic full migration off plaintext: by the time we're here we
    // hold the refresh token's real value regardless of which column it
    // came from (getIntegrationRow already resolved that), so a refresh is
    // also the moment a still-legacy row gets fully moved onto the
    // encrypted columns; re-encrypting the refresh token (unchanged by
    // Google in this flow; see google-calendar-client.ts) and clearing
    // both plaintext columns for this row.
    // Microsoft rotates refresh tokens on refresh; Google doesn't (keeps the old one).
    const refresh = this.encryption.encrypt(refreshed.refreshToken ?? integration.refreshToken);
    await this.db.withTenant(companyId, sql => sql`
      UPDATE workforce_calendar_integrations
      SET access_token = NULL, refresh_token = NULL,
        access_token_ciphertext = ${access.ciphertext}, access_token_iv = ${access.iv}, access_token_auth_tag = ${access.authTag},
        refresh_token_ciphertext = ${refresh.ciphertext}, refresh_token_iv = ${refresh.iv}, refresh_token_auth_tag = ${refresh.authTag},
        token_expires_at = ${refreshed.expiresAt}, updated_at = NOW()
      WHERE user_id = ${integration.userId} AND provider = ${provider}`);
    return refreshed.accessToken;
  }
}
