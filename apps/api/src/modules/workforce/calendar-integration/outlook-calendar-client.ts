import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { GoogleTokens } from './google-calendar-client';
import type { ExternalCalendarEvent } from './google-calendar-client';

// Read-only Outlook (Microsoft 365) calendar over Microsoft Graph, on the
// same Entra app registration the Outlook email integration already uses
// (MICROSOFT_OAUTH_CLIENT_ID/SECRET/TENANT), with its own redirect URI,
// since a calendar connection is a separate consent with a separate scope
// (Calendars.Read: read the user's own events, nothing else). Raw HTTP,
// same as google-calendar-client.ts; not unit-tested against the live API
// for the same reason (no real credentials here); the service's tests
// cover everything around it with this client mocked.
const SCOPES = 'offline_access https://graph.microsoft.com/Calendars.Read';

@Injectable()
export class OutlookCalendarClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('microsoftGraph.clientId') && this.config.get<string>('microsoftGraph.calendarRedirectUri'));
  }

  private get base(): string {
    const tenant = this.config.get<string>('microsoftGraph.tenant') || 'organizations';
    return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
  }

  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get<string>('microsoftGraph.clientId') ?? '',
      redirect_uri: this.config.get<string>('microsoftGraph.calendarRedirectUri') ?? '',
      response_type: 'code',
      response_mode: 'query',
      scope: SCOPES,
      prompt: 'select_account',
      state,
    });
    return `${this.base}/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.get<string>('microsoftGraph.calendarRedirectUri') ?? '',
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async token(body: Record<string, string>): Promise<GoogleTokens> {
    const res = await firstValueFrom(this.http.post(`${this.base}/token`, new URLSearchParams({
      client_id: this.config.get<string>('microsoftGraph.clientId') ?? '',
      client_secret: this.config.get<string>('microsoftGraph.clientSecret') ?? '',
      scope: SCOPES,
      ...body,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + Number(res.data.expires_in) * 1000).toISOString(),
    };
  }

  /** Events overlapping [timeMin, timeMax), times returned in UTC. */
  async listEventsInRange(accessToken: string, timeMin: string, timeMax: string): Promise<ExternalCalendarEvent[]> {
    const params = new URLSearchParams({
      startDateTime: timeMin,
      endDateTime: timeMax,
      $select: 'id,subject,start,end,isAllDay,isCancelled,webLink,location',
      $orderby: 'start/dateTime',
      $top: '250',
    });
    const res = await firstValueFrom(this.http.get(`https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    }));
    const items = (res.data.value ?? []) as Array<{
      id: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean; webLink?: string;
      start?: { dateTime?: string }; end?: { dateTime?: string }; location?: { displayName?: string };
    }>;
    return items
      .filter((e) => !e.isCancelled && e.start?.dateTime)
      .map((e) => ({
        id: e.id,
        title: e.subject || '(No title)',
        allDay: Boolean(e.isAllDay),
        // Graph returns UTC wall time without a zone suffix when asked for UTC.
        start: e.isAllDay ? e.start!.dateTime!.slice(0, 10) : `${e.start!.dateTime!.replace(/\.\d+$/, '')}Z`,
        end: e.end?.dateTime ? (e.isAllDay ? e.end.dateTime.slice(0, 10) : `${e.end.dateTime.replace(/\.\d+$/, '')}Z`) : null,
        url: e.webLink ?? null,
        location: e.location?.displayName || null,
      }));
  }
}
