import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { InitialProviderTokens, OutgoingMessage, ProviderTokens, SendResult } from '../email-integration.types';

// Thin wrapper over the Microsoft identity platform v2.0 OAuth endpoints and
// (once sending lands in a later stage) Microsoft Graph's /sendMail --
// deliberately no MSAL dependency, matching this codebase's existing
// preference for a raw HTTP client over a vendor SDK (see
// workforce/calendar-integration/google-calendar-client.ts's own comment on
// why). Not unit-tested for the same reason that file isn't: this is network
// glue to a live third-party API this sandbox has no real credentials for --
// see outlook-integration.service.spec.ts for what's actually covered (the
// DB-facing logic, with this client mocked).
//
// Scopes requested: `openid email offline_access
// https://graph.microsoft.com/Mail.Send` -- a *delegated* permission (acts
// as the signed-in user, never application-wide mailbox access -- see this
// phase's own report for why that distinction matters), and the minimum
// needed for this stage: `openid email` to get the connected mailbox address
// from the ID token with no extra Graph call, `offline_access` for a refresh
// token, `Mail.Send` to send as the user in a later stage. No Mail.Read,
// Mail.ReadWrite, or User.Read requested -- reading messages/replies is a
// separate, not-yet-implemented stage (Phase 3H) that will request its own
// additional scope only when it actually exists.
const SCOPES = 'openid email offline_access https://graph.microsoft.com/Mail.Send';

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

@Injectable()
export class MicrosoftGraphClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get authorizeBase(): string {
    const tenant = this.config.get<string>('microsoftGraph.tenant');
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  }

  buildAuthorizeUrl(state: string): string {
    const clientId = this.config.get<string>('microsoftGraph.clientId');
    const redirectUri = this.config.get<string>('microsoftGraph.redirectUri');
    const params = new URLSearchParams({
      client_id: clientId ?? '',
      redirect_uri: redirectUri ?? '',
      response_type: 'code',
      response_mode: 'query',
      scope: SCOPES,
      // Forces a fresh consent screen (and therefore a fresh refresh token)
      // every connect, same reasoning as Calendar's Google client using
      // prompt=consent -- a reconnect after disconnect must not silently
      // reuse an old grant.
      prompt: 'consent',
      state,
    });
    return `${this.authorizeBase}/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<InitialProviderTokens> {
    const clientId = this.config.get<string>('microsoftGraph.clientId');
    const clientSecret = this.config.get<string>('microsoftGraph.clientSecret');
    const redirectUri = this.config.get<string>('microsoftGraph.redirectUri');

    const res = await firstValueFrom(this.http.post<MicrosoftTokenResponse>(`${this.authorizeBase}/token`, new URLSearchParams({
      code,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      redirect_uri: redirectUri ?? '',
      grant_type: 'authorization_code',
      scope: SCOPES,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    if (!res.data.refresh_token) {
      throw new Error('Microsoft did not return a refresh token for this connection.');
    }
    if (!res.data.id_token) {
      throw new Error('Microsoft did not return an ID token -- cannot confirm the connected mailbox address.');
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
    const clientId = this.config.get<string>('microsoftGraph.clientId');
    const clientSecret = this.config.get<string>('microsoftGraph.clientSecret');

    const res = await firstValueFrom(this.http.post<MicrosoftTokenResponse>(`${this.authorizeBase}/token`, new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      grant_type: 'refresh_token',
      scope: SCOPES,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));

    return {
      accessToken: res.data.access_token,
      // Microsoft rotates refresh tokens on every use -- the old one is
      // invalidated the moment a new one is issued, so this must be
      // persisted, unlike Google's "only on initial grant" behavior.
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000).toISOString(),
      grantedScopes: res.data.scope,
    };
  }

  // Create-draft-then-send, not the simpler single-call /me/sendMail --
  // sendMail returns no body at all (202 Accepted, nothing else), so there
  // would be no message/conversation ID to record for Section 8's audit
  // trail or Phase 3H's future reply-threading. Creating the message as a
  // draft first returns its id and conversationId; sending that specific
  // draft by id is then a second call.
  async sendMail(accessToken: string, message: OutgoingMessage): Promise<SendResult> {
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    const draft = await firstValueFrom(this.http.post<{ id: string; conversationId: string }>(
      'https://graph.microsoft.com/v1.0/me/messages',
      {
        subject: message.subject,
        body: { contentType: 'Text', content: message.bodyText },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: message.cc.map((address) => ({ emailAddress: { address } })),
        bccRecipients: message.bcc.map((address) => ({ emailAddress: { address } })),
        attachments: message.attachments.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType,
          contentBytes: a.contentBase64,
        })),
      },
      { headers },
    ));

    // If this second call fails after the draft above was created, the
    // draft is left behind in the user's own Drafts folder rather than
    // sent -- a minor, self-correcting edge case (visible and deletable by
    // the user in their own mailbox, not a data-safety issue) rather than
    // something worth a compensating-transaction cleanup call here.
    await firstValueFrom(this.http.post(`https://graph.microsoft.com/v1.0/me/messages/${draft.data.id}/send`, {}, { headers }));

    return { providerMessageId: draft.data.id, threadId: draft.data.conversationId };
  }

  // The ID token is a JWT issued directly by Microsoft's own token endpoint
  // over TLS in this same request/response -- not something that arrived via
  // a redirect or any other less-trusted path -- so decoding its payload
  // without re-verifying the signature is standard practice here (the same
  // trust boundary already applies to the access/refresh tokens in the same
  // response). Only ever used to read the `email` claim, never passed
  // anywhere else or stored.
  private extractEmailFromIdToken(idToken: string): string {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Malformed ID token from Microsoft.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { email?: string; preferred_username?: string };
    const email = payload.email ?? payload.preferred_username;
    if (!email) throw new Error('Microsoft ID token did not include an email claim.');
    return email;
  }
}
