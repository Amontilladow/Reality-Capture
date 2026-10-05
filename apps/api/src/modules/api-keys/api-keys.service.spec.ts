import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApiKeysService } from './api-keys.service';
import type { DatabaseService } from '../../database/database.service';

describe('ApiKeysService', () => {
  describe('create', () => {
    it('returns the full secret once, but only ever persists its SHA-256 hash', async () => {
      let persistedHash: string | undefined;
      const withTenant = jest.fn(async (_companyId: string, fn: (sql: unknown) => unknown) => {
        const fakeSql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
          persistedHash = values.find((v): v is string => typeof v === 'string' && v.length === 64);
          return [{ id: 'key-1', name: 'CI integration', keyPrefix: values[1], scopes: ['read'], createdAt: '2026-01-01' }];
        };
        return fn(fakeSql);
      });
      const db = { withTenant };
      const svc = new ApiKeysService(db as unknown as DatabaseService);

      const result = await svc.create('company-1', 'user-1', 'CI integration');

      expect(result.apiKey).toMatch(/^rc_live_[a-f0-9]{48}$/);
      expect(persistedHash).toBe(createHash('sha256').update(result.apiKey).digest('hex'));
      // The row returned to the controller never carries key_hash.
      expect(result).not.toHaveProperty('keyHash');
    });
  });

  describe('revoke', () => {
    it('throws NotFoundException when no active key matches', async () => {
      const withTenant = jest.fn().mockResolvedValue([]);
      const svc = new ApiKeysService({ withTenant } as unknown as DatabaseService);
      await expect(svc.revoke('company-1', 'key-missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('revokes an active key scoped to the caller\'s company', async () => {
      const withTenant = jest.fn().mockResolvedValue([{ id: 'key-1' }]);
      const svc = new ApiKeysService({ withTenant } as unknown as DatabaseService);
      const result = await svc.revoke('company-1', 'key-1', 'user-1');
      expect(result).toEqual({ message: 'API key revoked.' });
    });
  });
});
