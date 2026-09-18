import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../database/database.service';
import { GoogleCalendarClient, type CalendarEventSummary } from './google-calendar-client';
import { signOAuthState, verifyOAuthState } from './oauth-state.util';

interface IntegrationRow {
  userId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
}

@Injectable()
export class CalendarIntegrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly googleClient: GoogleCalendarClient,
  ) {}

  private get stateSecret(): string {
    return this.config.get<string>('jwt.accessSecret')!;
  }

  getAuthorizeUrl(companyId: string, userId: string): string {
    const state = signOAuthState(this.stateSecret, companyId, userId);
    return this.googleClient.buildAuthorizeUrl(state);
  }

  // Verifies `state` (see oauth-state.util.ts's own comment for why this
  // needs no database lookup to identify who initiated the flow), then
  // exchanges the code and stores the resulting tokens. Throws on any
  // failure -- the controller decides what that means for the redirect the
  // user's browser ends up at, this service only ever deals in success or
  // a thrown error, never a partial/ambiguous state.
  async handleCallback(code: string, state: string): Promise<{ companyId: string }> {
    const { companyId, userId } = verifyOAuthState(this.stateSecret, state);
    const tokens = await this.googleClient.exchangeCodeForTokens(code);
    const refreshToken = tokens.refreshToken;

    if (!refreshToken) {
      // Google only omits this on a rare re-consent edge case where
      // `prompt=consent` didn't force a fresh grant. Refuse rather than
      // store a connection with no way to refresh past the short-lived
      // access token.
      throw new Error('Google did not return a refresh token for this connection.');
    }

    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO workforce_calendar_integrations (company_id, user_id, provider, access_token, refresh_token, token_expires_at, connected_by)
      VALUES (${companyId}, ${userId}, 'google_calendar', ${tokens.accessToken}, ${refreshToken}, ${tokens.expiresAt}, ${userId})
      ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        connected_at = NOW(),
        connected_by = EXCLUDED.connected_by,
        updated_at = NOW()`);

    return { companyId };
  }

  async getStatus(companyId: string, userId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT connected_at, last_used_at FROM workforce_calendar_integrations
      WHERE user_id = ${userId} AND provider = 'google_calendar'`);
    return {
      connected: !!row,
      connectedAt: (row?.connectedAt as string | undefined) ?? null,
      lastUsedAt: (row?.lastUsedAt as string | undefined) ?? null,
    };
  }

  async disconnect(companyId: string, userId: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      DELETE FROM workforce_calendar_integrations WHERE user_id = ${userId} AND provider = 'google_calendar'`);
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

  private async getIntegrationRow(companyId: string, userId: string): Promise<IntegrationRow | undefined> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT user_id, access_token, refresh_token, token_expires_at FROM workforce_calendar_integrations
      WHERE user_id = ${userId} AND provider = 'google_calendar'`);
    return row as IntegrationRow | undefined;
  }

  // 60s safety margin against a token expiring mid-request rather than
  // racing the exact expiry instant.
  private async ensureFreshAccessToken(companyId: string, integration: IntegrationRow): Promise<string> {
    const expiresAt = new Date(integration.tokenExpiresAt);
    if (expiresAt.getTime() > Date.now() + 60_000) {
      return integration.accessToken;
    }

    const refreshed = await this.googleClient.refreshAccessToken(integration.refreshToken);
    await this.db.withTenant(companyId, sql => sql`
      UPDATE workforce_calendar_integrations
      SET access_token = ${refreshed.accessToken}, token_expires_at = ${refreshed.expiresAt}, updated_at = NOW()
      WHERE user_id = ${integration.userId} AND provider = 'google_calendar'`);
    return refreshed.accessToken;
  }
}
