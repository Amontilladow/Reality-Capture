import { Injectable } from '@nestjs/common';
import type { EmailProvider, EmailIntegrationStatus } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { CredentialEncryptionService, type EncryptedCredential } from '../../common/crypto/credential-encryption.service';
import type { ProviderTokens, DecryptedConnection } from './email-integration.types';

interface IntegrationRow {
  userId: string;
  connectedEmail: string;
  connectedAt: string;
  lastUsedAt: string | null;
  tokenExpiresAt: string;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
}

// Phase 3B's shared piece: every provider-specific *IntegrationService
// (OutlookIntegrationService / GmailIntegrationService, Phase 3C/3D) composes
// one of these instead of hand-rolling its own encrypted-storage SQL --
// exactly the role CredentialEncryptionService itself plays one level down
// (this class is its one real caller for email_integrations, same way
// AiConnectionsService is its caller for user_ai_connections). Keeps the
// "never log/return a plaintext token" and "encrypt before it touches SQL"
// rules enforced in one place rather than duplicated per provider.
@Injectable()
export class EmailTokenStore {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  async upsert(companyId: string, userId: string, provider: EmailProvider, connectedEmail: string, tokens: Required<ProviderTokens>): Promise<void> {
    const access = this.encryption.encrypt(tokens.accessToken);
    const refresh = this.encryption.encrypt(tokens.refreshToken);

    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO email_integrations (
        company_id, user_id, provider, connected_email, scopes,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
        token_expires_at, connected_by, last_error_code, last_error_at
      ) VALUES (
        ${companyId}, ${userId}, ${provider}, ${connectedEmail}, ${tokens.grantedScopes},
        ${access.ciphertext}, ${access.iv}, ${access.authTag},
        ${refresh.ciphertext}, ${refresh.iv}, ${refresh.authTag},
        ${tokens.expiresAt}, ${userId}, NULL, NULL
      )
      ON CONFLICT (user_id, provider) DO UPDATE SET
        connected_email = EXCLUDED.connected_email,
        scopes = EXCLUDED.scopes,
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        access_token_iv = EXCLUDED.access_token_iv,
        access_token_auth_tag = EXCLUDED.access_token_auth_tag,
        refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
        refresh_token_iv = EXCLUDED.refresh_token_iv,
        refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
        token_expires_at = EXCLUDED.token_expires_at,
        connected_at = NOW(),
        connected_by = EXCLUDED.connected_by,
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = NOW()`);
  }

  // Refresh-only update -- a new access token (and, for providers that
  // rotate it, a new refresh token), but connected_email/scopes/connected_at
  // are untouched since this isn't a new grant.
  async updateAfterRefresh(companyId: string, userId: string, provider: EmailProvider, tokens: ProviderTokens): Promise<void> {
    const access = this.encryption.encrypt(tokens.accessToken);
    if (tokens.refreshToken) {
      const refresh = this.encryption.encrypt(tokens.refreshToken);
      await this.db.withTenant(companyId, sql => sql`
        UPDATE email_integrations SET
          access_token_ciphertext = ${access.ciphertext}, access_token_iv = ${access.iv}, access_token_auth_tag = ${access.authTag},
          refresh_token_ciphertext = ${refresh.ciphertext}, refresh_token_iv = ${refresh.iv}, refresh_token_auth_tag = ${refresh.authTag},
          token_expires_at = ${tokens.expiresAt}, last_error_code = NULL, last_error_at = NULL, updated_at = NOW()
        WHERE user_id = ${userId} AND provider = ${provider}`);
      return;
    }
    await this.db.withTenant(companyId, sql => sql`
      UPDATE email_integrations SET
        access_token_ciphertext = ${access.ciphertext}, access_token_iv = ${access.iv}, access_token_auth_tag = ${access.authTag},
        token_expires_at = ${tokens.expiresAt}, last_error_code = NULL, last_error_at = NULL, updated_at = NOW()
      WHERE user_id = ${userId} AND provider = ${provider}`);
  }

  // Called when a refresh or send attempt fails -- e.g. 'invalid_grant'
  // (the user revoked consent at the provider). Never store the provider's
  // raw error body here, only a short code: Section 5's "no token values in
  // logs" extends to "no provider error payloads that might themselves
  // quote back a credential."
  async recordError(companyId: string, userId: string, provider: EmailProvider, errorCode: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE email_integrations SET last_error_code = ${errorCode}, last_error_at = NOW(), updated_at = NOW()
      WHERE user_id = ${userId} AND provider = ${provider}`);
  }

  async touchLastUsed(companyId: string, userId: string, provider: EmailProvider): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE email_integrations SET last_used_at = NOW() WHERE user_id = ${userId} AND provider = ${provider}`);
  }

  async disconnect(companyId: string, userId: string, provider: EmailProvider): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      DELETE FROM email_integrations WHERE user_id = ${userId} AND provider = ${provider}`);
  }

  async getStatus(companyId: string, userId: string, provider: EmailProvider): Promise<EmailIntegrationStatus> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT connected_email, connected_at, last_used_at, token_expires_at, last_error_code, last_error_at
      FROM email_integrations WHERE user_id = ${userId} AND provider = ${provider}`);

    if (!row) {
      return { provider, status: 'not_connected', connectedEmail: null, connectedAt: null, lastUsedAt: null, lastErrorMessage: null };
    }

    const typed = row as {
      connectedEmail: string; connectedAt: string; lastUsedAt: string | null;
      tokenExpiresAt: string; lastErrorCode: string | null; lastErrorAt: string | null;
    };

    return {
      provider,
      status: this.deriveStatus(typed.tokenExpiresAt, typed.lastErrorCode),
      connectedEmail: typed.connectedEmail,
      connectedAt: typed.connectedAt,
      lastUsedAt: typed.lastUsedAt,
      lastErrorMessage: typed.lastErrorCode ? this.describeError(typed.lastErrorCode) : null,
    };
  }

  // 'invalid_grant'/'consent_revoked'-shaped codes mean the user (or an
  // admin) revoked access at the provider -- no amount of retrying the
  // refresh will fix that, the user must reconnect. Anything else
  // recorded as an error is treated as transient/unknown ('error'), and a
  // token past its expiry with no recorded error yet is 'connection_expired'
  // -- a state that should be rare and brief given every read path refreshes
  // proactively (see calendar-integration's identical ensureFreshAccessToken
  // pattern, reused by each provider's own send/connect logic in 3C/3D).
  private deriveStatus(tokenExpiresAt: string, lastErrorCode: string | null): EmailIntegrationStatus['status'] {
    if (lastErrorCode === 'invalid_grant' || lastErrorCode === 'consent_revoked') return 'authorization_required';
    if (lastErrorCode) return 'error';
    if (new Date(tokenExpiresAt).getTime() < Date.now()) return 'connection_expired';
    return 'connected';
  }

  private describeError(code: string): string {
    if (code === 'invalid_grant' || code === 'consent_revoked') {
      return 'Authorization was revoked. Reconnect this account to continue.';
    }
    return 'This connection is reporting an error. Try reconnecting the account.';
  }

  async getDecrypted(companyId: string, userId: string, provider: EmailProvider): Promise<DecryptedConnection | null> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT user_id, connected_email, token_expires_at,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
      FROM email_integrations WHERE user_id = ${userId} AND provider = ${provider}`);
    if (!row) return null;
    const typed = row as unknown as IntegrationRow;

    const accessToken = this.encryption.decrypt(this.asCredential(typed.accessTokenCiphertext, typed.accessTokenIv, typed.accessTokenAuthTag));
    const refreshToken = this.encryption.decrypt(this.asCredential(typed.refreshTokenCiphertext, typed.refreshTokenIv, typed.refreshTokenAuthTag));

    return {
      userId: typed.userId,
      connectedEmail: typed.connectedEmail,
      accessToken,
      refreshToken,
      tokenExpiresAt: typed.tokenExpiresAt,
    };
  }

  private asCredential(ciphertext: string, iv: string, authTag: string): EncryptedCredential {
    return { ciphertext, iv, authTag };
  }
}
