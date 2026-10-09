import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailIntegrationStatus } from '@engineeringos/types';
import { EmailTokenStore } from '../email-token-store.service';
import { MicrosoftGraphClient } from './microsoft-graph-client';
import { signEmailOAuthState, verifyEmailOAuthState } from '../oauth-state.util';

const PROVIDER = 'microsoft' as const;

@Injectable()
export class OutlookIntegrationService {
  constructor(
    private readonly tokenStore: EmailTokenStore,
    private readonly config: ConfigService,
    private readonly client: MicrosoftGraphClient,
  ) {}

  private get stateSecret(): string {
    return this.config.get<string>('jwt.accessSecret')!;
  }

  getAuthorizeUrl(companyId: string, userId: string): string {
    const state = signEmailOAuthState(this.stateSecret, companyId, userId, PROVIDER);
    return this.client.buildAuthorizeUrl(state);
  }

  async handleCallback(code: string, state: string): Promise<{ companyId: string }> {
    const { companyId, userId } = verifyEmailOAuthState(this.stateSecret, state, PROVIDER);
    const tokens = await this.client.exchangeCodeForTokens(code);
    await this.tokenStore.upsert(companyId, userId, PROVIDER, tokens.connectedEmail, tokens);
    return { companyId };
  }

  async getStatus(companyId: string, userId: string): Promise<EmailIntegrationStatus> {
    return this.tokenStore.getStatus(companyId, userId, PROVIDER);
  }

  async disconnect(companyId: string, userId: string): Promise<void> {
    await this.tokenStore.disconnect(companyId, userId, PROVIDER);
  }

  // Re-verifies the connection right now rather than trusting the last
  // stored status -- refreshes the access token (the same operation sending
  // mail will need in a later stage) and reports whether that succeeded.
  // Never sends a real email: Section 13's "never send test messages to
  // real external recipients without explicit approval" rules that out for
  // an automatic "Test connection" action.
  async testConnection(companyId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    const connection = await this.tokenStore.getDecrypted(companyId, userId, PROVIDER);
    if (!connection) return { ok: false, error: 'Not connected.' };

    try {
      const refreshed = await this.client.refreshAccessToken(connection.refreshToken);
      await this.tokenStore.updateAfterRefresh(companyId, userId, PROVIDER, refreshed);
      await this.tokenStore.touchLastUsed(companyId, userId, PROVIDER);
      return { ok: true };
    } catch {
      // Microsoft's token endpoint returns 400 invalid_grant for a
      // revoked/expired refresh token -- the HTTP client layer doesn't
      // parse that out today (same simplicity as Calendar's client), so
      // any refresh failure here is recorded as the user needing to
      // reconnect, the safe default interpretation.
      await this.tokenStore.recordError(companyId, userId, PROVIDER, 'invalid_grant');
      return { ok: false, error: 'This connection is no longer valid. Please reconnect.' };
    }
  }

  // Used by a later stage (the composer / send-mail path) -- refreshes only
  // when the stored token is actually near expiry, same pattern Calendar's
  // ensureFreshAccessToken already uses (60s safety margin).
  async ensureFreshAccessToken(companyId: string, userId: string): Promise<string | null> {
    const connection = await this.tokenStore.getDecrypted(companyId, userId, PROVIDER);
    if (!connection) return null;

    if (new Date(connection.tokenExpiresAt).getTime() > Date.now() + 60_000) {
      return connection.accessToken;
    }

    try {
      const refreshed = await this.client.refreshAccessToken(connection.refreshToken);
      await this.tokenStore.updateAfterRefresh(companyId, userId, PROVIDER, refreshed);
      return refreshed.accessToken;
    } catch {
      await this.tokenStore.recordError(companyId, userId, PROVIDER, 'invalid_grant');
      return null;
    }
  }
}
