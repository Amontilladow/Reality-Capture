import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailIntegrationStatus } from '@engineeringos/types';
import { EmailTokenStore } from '../email-token-store.service';
import { GmailClient } from './gmail-client';
import { signEmailOAuthState, verifyEmailOAuthState } from '../oauth-state.util';
import type { OutgoingMessage, SendResult } from '../email-integration.types';

const PROVIDER = 'google' as const;

// Mirrors OutlookIntegrationService (Phase 3C) exactly -- same shape, same
// EmailTokenStore composition, same testConnection()/ensureFreshAccessToken()
// contracts -- so a later sending/composer stage can treat both providers
// identically rather than special-casing each one.
@Injectable()
export class GmailIntegrationService {
  constructor(
    private readonly tokenStore: EmailTokenStore,
    private readonly config: ConfigService,
    private readonly client: GmailClient,
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

  // Never sends a real email -- see OutlookIntegrationService.testConnection()'s
  // identical comment (Section 13: "never send test messages to real
  // external recipients without explicit approval").
  async testConnection(companyId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    const connection = await this.tokenStore.getDecrypted(companyId, userId, PROVIDER);
    if (!connection) return { ok: false, error: 'Not connected.' };

    try {
      const refreshed = await this.client.refreshAccessToken(connection.refreshToken);
      await this.tokenStore.updateAfterRefresh(companyId, userId, PROVIDER, refreshed);
      await this.tokenStore.touchLastUsed(companyId, userId, PROVIDER);
      return { ok: true };
    } catch {
      // Google's token endpoint returns 400 invalid_grant for a
      // revoked/expired refresh token -- same simplified interpretation
      // as Outlook's client (the HTTP layer doesn't parse the specific
      // error code out today), treated as "needs reconnect."
      await this.tokenStore.recordError(companyId, userId, PROVIDER, 'invalid_grant');
      return { ok: false, error: 'This connection is no longer valid. Please reconnect.' };
    }
  }

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

  // Mirrors OutlookIntegrationService.sendMail() exactly -- see its comment
  // for the shared reasoning (senderEmail returned alongside the provider
  // result, throws rather than returning a failure value on any problem).
  async sendMail(companyId: string, userId: string, message: OutgoingMessage): Promise<SendResult & { senderEmail: string }> {
    const connection = await this.tokenStore.getDecrypted(companyId, userId, PROVIDER);
    if (!connection) throw new BadRequestException('Gmail is not connected for this user.');

    const accessToken = await this.ensureFreshAccessToken(companyId, userId);
    if (!accessToken) throw new BadRequestException('The Gmail connection is no longer valid. Please reconnect.');

    const result = await this.client.sendMail(accessToken, message);
    await this.tokenStore.touchLastUsed(companyId, userId, PROVIDER);
    return { ...result, senderEmail: connection.connectedEmail };
  }
}
