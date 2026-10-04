import { randomBytes, createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

const KEY_PREFIX = 'rc_live_';

@Injectable()
export class ApiKeysService {
  constructor(private readonly db: DatabaseService) {}

  // The full secret is shown to the caller exactly once, at creation --
  // only its SHA-256 hash is ever persisted (see migration 056's comment
  // for why this mirrors refresh_tokens' hashing, not progress-report-share's
  // raw-token storage). Losing it means generating a new key; there is no
  // "reveal" endpoint, same as a password.
  async create(companyId: string, userId: string, name: string) {
    const secret = randomBytes(24).toString('hex');
    const fullKey = `${KEY_PREFIX}${secret}`;
    const keyHash = createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = `${KEY_PREFIX}${secret.slice(0, 8)}`;

    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO api_keys (company_id, name, key_prefix, key_hash, created_by)
      VALUES (${companyId}, ${name}, ${keyPrefix}, ${keyHash}, ${userId})
      RETURNING id, name, key_prefix, scopes, created_at
    `);

    return { ...row, apiKey: fullKey };
  }

  // Never selects key_hash -- same "don't re-display a bearer credential"
  // practice as rfi-external-access.service.ts's list().
  async list(companyId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, created_by, created_at
      FROM api_keys WHERE company_id = ${companyId} ORDER BY created_at DESC
    `);
  }

  async revoke(companyId: string, keyId: string, userId: string) {
    const [revoked] = await this.db.withTenant(companyId, sql => sql`
      UPDATE api_keys SET revoked_at = NOW(), revoked_by = ${userId}
      WHERE id = ${keyId} AND company_id = ${companyId} AND revoked_at IS NULL
      RETURNING id
    `);
    if (!revoked) throw new NotFoundException({ code: 'API_KEY_NOT_FOUND', message: 'No active API key found with that id.' });
    return { message: 'API key revoked.' };
  }
}
