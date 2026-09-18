import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string; // absent on a refresh response -- Google only issues a new refresh token on the initial grant
  expiresAt: string;
}

export interface CalendarEventSummary {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
}

// Thin wrapper over Google's OAuth token endpoint and Calendar API v3 --
// deliberately no `googleapis` SDK dependency, same "raw HTTP client over a
// heavy vendor SDK" preference this codebase already applies elsewhere
// (the desktop agent's api-client.ts, apps/browser-extension). Not
// unit-tested: this is network glue talking to a live third-party API this
// sandbox has no real credentials or network access to verify against --
// see calendar-integration.service.ts's own tests for what actually is
// covered (the DB-facing logic, with this client mocked).
@Injectable()
export class GoogleCalendarClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  buildAuthorizeUrl(state: string): string {
    const clientId = this.config.get<string>('googleCalendar.clientId');
    const redirectUri = this.config.get<string>('googleCalendar.redirectUri');
    const params = new URLSearchParams({
      client_id: clientId ?? '',
      redirect_uri: redirectUri ?? '',
      response_type: 'code',
      // Read-only -- this integration only ever reads events, never
      // creates/modifies/deletes anything on the user's calendar.
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline', // required to receive a refresh_token
      prompt: 'consent', // forces a refresh_token on every connect, not just the first ever grant for that Google account
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    const clientId = this.config.get<string>('googleCalendar.clientId');
    const clientSecret = this.config.get<string>('googleCalendar.clientSecret');
    const redirectUri = this.config.get<string>('googleCalendar.redirectUri');

    const res = await firstValueFrom(this.http.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      redirect_uri: redirectUri ?? '',
      grant_type: 'authorization_code',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    return this.toTokens(res.data);
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    const clientId = this.config.get<string>('googleCalendar.clientId');
    const clientSecret = this.config.get<string>('googleCalendar.clientSecret');

    const res = await firstValueFrom(this.http.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      grant_type: 'refresh_token',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    return this.toTokens(res.data);
  }

  async listEvents(accessToken: string, timeMin: string, timeMax: string): Promise<CalendarEventSummary[]> {
    const params = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime',
    });
    const res = await firstValueFrom(this.http.get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));

    const items = (res.data.items ?? []) as Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }>;
    return items
      .filter((item) => item.start?.dateTime && item.end?.dateTime) // skip all-day events -- they have `date`, not `dateTime`, and no meaningful start/end time to track
      .map((item) => ({
        id: item.id,
        title: item.summary ?? '(No title)',
        startTime: item.start!.dateTime!,
        endTime: item.end!.dateTime!,
      }));
  }

  private toTokens(data: { access_token: string; refresh_token?: string; expires_in: number }): GoogleTokens {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  }
}
