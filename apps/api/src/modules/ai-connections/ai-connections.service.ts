import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import { ProviderFactory } from '../ai/providers/provider.factory';
import type { AIProvider } from '../ai/providers/ai-provider.interface';
import type { ConnectAiProviderDto, ByoAiProvider } from './dto/connect-ai-provider.dto';

export interface AiConnectionStatus {
  connected: boolean;
  provider?: ByoAiProvider;
  model?: string;
  baseUrl?: string | null;
  apiKeyLast4?: string;
  lastValidatedAt?: string | null;
  lastValidationError?: string | null;
}

interface DecryptedConnection {
  provider: ByoAiProvider;
  model: string;
  baseUrl?: string | null;
  apiKey?: string;
}

// Spec sections 5-8, 23: a user's OWN AI provider connection ("My AI
// Provider" / Mode B). Stores credentials encrypted at rest
// (CredentialEncryptionService) and never returns the plaintext key again
// after it's first submitted -- only a last-4 fingerprint, same convention
// the existing Public API Keys feature uses for its own secret.
//
// One connection per user (not per company), matching the spec's framing
// of this as a personal credential, not a company-wide setting.
@Injectable()
export class AiConnectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryption: CredentialEncryptionService,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async getStatus(companyId: string, userId: string): Promise<AiConnectionStatus> {
    const [row] = await this.db.withTenant(companyId, (sql) => sql`
      SELECT provider, model, base_url, api_key_last4, last_validated_at, last_validation_error
      FROM user_ai_connections WHERE user_id = ${userId} AND company_id = ${companyId}
    `) as Record<string, unknown>[];
    if (!row) return { connected: false };
    return {
      connected: true,
      provider: row.provider as ByoAiProvider,
      model: row.model as string,
      baseUrl: row.baseUrl as string | null,
      apiKeyLast4: row.apiKeyLast4 as string,
      lastValidatedAt: row.lastValidatedAt as string | null,
      lastValidationError: row.lastValidationError as string | null,
    };
  }

  // Upserts the user's connection, validating the credentials against the
  // real provider BEFORE storing anything -- a connection that was never
  // tested isn't saved as "connected" with no way to tell the user it
  // doesn't actually work.
  async connect(companyId: string, userId: string, dto: ConnectAiProviderDto): Promise<AiConnectionStatus> {
    const provider = this.providerFactory.buildFromCredentials(dto.provider, dto.model, dto.apiKey, dto.baseUrl);
    const validation = await provider.validateConnection();
    if (!validation.ok) {
      throw new BadRequestException(`Could not connect: ${validation.error ?? 'the provider rejected these credentials.'}`);
    }

    const encrypted = this.encryption.encrypt(dto.apiKey ?? '');
    const last4 = (dto.apiKey ?? '').slice(-4);

    await this.db.withTenant(companyId, (sql) => sql`
      INSERT INTO user_ai_connections (
        user_id, company_id, provider, model, base_url,
        api_key_ciphertext, api_key_iv, api_key_auth_tag, api_key_last4,
        last_validated_at, last_validation_error
      ) VALUES (
        ${userId}, ${companyId}, ${dto.provider}, ${dto.model}, ${dto.baseUrl ?? null},
        ${encrypted.ciphertext}, ${encrypted.iv}, ${encrypted.authTag}, ${last4},
        NOW(), NULL
      )
      ON CONFLICT (user_id) DO UPDATE SET
        provider = EXCLUDED.provider, model = EXCLUDED.model, base_url = EXCLUDED.base_url,
        api_key_ciphertext = EXCLUDED.api_key_ciphertext, api_key_iv = EXCLUDED.api_key_iv,
        api_key_auth_tag = EXCLUDED.api_key_auth_tag, api_key_last4 = EXCLUDED.api_key_last4,
        last_validated_at = NOW(), last_validation_error = NULL, updated_at = NOW()
    `);

    return this.getStatus(companyId, userId);
  }

  async testConnection(companyId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    const connection = await this.getDecrypted(companyId, userId);
    if (!connection) throw new BadRequestException('No AI provider connected.');

    const provider = this.providerFactory.buildFromCredentials(connection.provider, connection.model, connection.apiKey, connection.baseUrl ?? undefined);
    const result = await provider.validateConnection();

    await this.db.withTenant(companyId, (sql) => sql`
      UPDATE user_ai_connections SET last_validated_at = NOW(), last_validation_error = ${result.ok ? null : (result.error ?? 'Unknown error')}, updated_at = NOW()
      WHERE user_id = ${userId} AND company_id = ${companyId}
    `);

    return result;
  }

  async disconnect(companyId: string, userId: string): Promise<void> {
    await this.db.withTenant(companyId, (sql) => sql`
      DELETE FROM user_ai_connections WHERE user_id = ${userId} AND company_id = ${companyId}
    `);
  }

  // Used by AiService (modules/ai) to resolve which provider actually
  // answers a given request. Returns null when the user has no connection
  // (or hasn't turned BYO mode on) -- AiService falls back to
  // ProviderFactory.getProvider() (RealityCapture's own) in that case.
  async getProviderForUser(companyId: string, userId: string): Promise<AIProvider | null> {
    const connection = await this.getDecrypted(companyId, userId);
    if (!connection) return null;
    return this.providerFactory.buildFromCredentials(connection.provider, connection.model, connection.apiKey, connection.baseUrl ?? undefined);
  }

  private async getDecrypted(companyId: string, userId: string): Promise<DecryptedConnection | null> {
    const [row] = await this.db.withTenant(companyId, (sql) => sql`
      SELECT provider, model, base_url, api_key_ciphertext, api_key_iv, api_key_auth_tag
      FROM user_ai_connections WHERE user_id = ${userId} AND company_id = ${companyId}
    `) as Record<string, unknown>[];
    if (!row) return null;
    const apiKey = this.encryption.decrypt({
      ciphertext: row.apiKeyCiphertext as string,
      iv: row.apiKeyIv as string,
      authTag: row.apiKeyAuthTag as string,
    });
    return {
      provider: row.provider as ByoAiProvider,
      model: row.model as string,
      baseUrl: row.baseUrl as string | null,
      apiKey: apiKey || undefined,
    };
  }
}
