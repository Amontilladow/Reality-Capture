import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { InitialProviderTokens, ProviderTokens } from '../email-integration.types';

// Thin wrapper over Google's OAuth token endpoint, same "raw HTTP client,
// no vendor SDK" convention as GoogleCalendarClient (workforce/
// calendar-integration) and MicrosoftGraphClient (Phase 3C) -- no
// googleapis dependency. Not unit-tested for the same reason those
// aren't: live third-party network glue this sandbox has no real
// credentials for. See gmail-integration.service.spec.ts for what's
// actually covered.
//
// Scope requested: `openid email
// https://www.googleapis.com/auth/gmail.send` -- the brief's own
// "prefer sending-only authorization if a user only needs to send
// email" and "request minimum scopes necessary" directly. `openid
// email` gets the connected mailbox address from the ID token with no
// extra People API call; `gmail.send` only -- not gmail.readonly,
// gmail.modify, or the full https://mail.google.com/ scope. No read
// access is requested because nothing in this codebase reads mail yet
// (Phase 3H, not built) -- requesting it now would be exactly the
// "broader permissions... only if the relevant feature genuinely
// requires them" violation the brief warns against.
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string; // absent on a refresh response -- Google only issues one on the initial grant
  expires_in: number;
  scope: string;
  id_token?: string;
}

@Injectable()
export class GmailClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  buildAuthorizeUrl(state: string): string {
    const clientId = this.config.get<string>('gmail.clientId');
    const redirectUri = this.config.get<string>('gmail.redirectUri');
    const params = new URLSearchParams({
      client_id: clientId ?? '',
      redirect_uri: redirectUri ?? '',
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline', // required to receive a refresh_token
      prompt: 'consent', // forces a fresh refresh_token on every connect, not just the first-ever grant -- same reasoning as Calendar's own client
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<InitialProviderTokens> {
    const clientId = this.config.get<string>('gmail.clientId');
    const clientSecret = this.config.get<string>('gmail.clientSecret');
    const redirectUri = this.config.get<string>('gmail.redirectUri');

    const res = await firstValueFrom(this.http.post<GoogleTokenResponse>('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      redirect_uri: redirectUri ?? '',
      grant_type: 'authorization_code',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    if (!res.data.refresh_token) {
      throw new Error('Google did not return a refresh token for this connection.');
    }
    if (!res.data.id_token) {
      throw new Error('Google did not return an ID token -- cannot confirm the connected mailbox address.');
    }

    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000).toISOString(),
      grantedScopes: res.data.scope,
      connectedEmail: this.extractEmailFromIdToken(res.data.id_token),
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<ProviderTokens> {
    const clientId = this.config.get<string>('gmail.clientId');
    const clientSecret = this.config.get<string>('gmail.clientSecret');

    const res = await firstValueFrom(this.http.post<GoogleTokenResponse>('https://oauth2.googleapis.com/token', new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      grant_type: 'refresh_token',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    return {
      accessToken: res.data.access_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000).toISOString(),
      grantedScopes: res.data.scope,
    };
  }

  // Same trust reasoning as MicrosoftGraphClient's identical method: the ID
  // token came directly from Google's own token endpoint over TLS in this
  // same request/response, not via any less-trusted path, so decoding its
  // payload without re-verifying the signature is standard practice here.
  private extractEmailFromIdToken(idToken: string): string {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Malformed ID token from Google.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { email?: string };
    if (!payload.email) throw new Error('Google ID token did not include an email claim.');
    return payload.email;
  }
}
