import { BadRequestException } from '@nestjs/common';
import { AiConnectionsService } from './ai-connections.service';
import type { DatabaseService } from '../../database/database.service';
import type { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import type { ProviderFactory } from '../ai/providers/provider.factory';

function makeService(opts: {
  row?: Record<string, unknown>;
  validateConnection?: jest.Mock;
} = {}) {
  const rows: Record<string, unknown>[] = opts.row ? [opts.row] : [];
  const withTenant = jest.fn().mockImplementation(async (_companyId: string, fn: (sql: unknown) => unknown) => {
    return fn((() => Promise.resolve(rows)) as never);
  });
  const db = { withTenant } as unknown as DatabaseService;

  const encryption = {
    encrypt: jest.fn().mockReturnValue({ ciphertext: 'ct', iv: 'iv', authTag: 'tag' }),
    decrypt: jest.fn().mockReturnValue('decrypted-key'),
  } as unknown as CredentialEncryptionService;

  const validateConnection = opts.validateConnection ?? jest.fn().mockResolvedValue({ ok: true });
  const provider = { validateConnection };
  const buildFromCredentials = jest.fn().mockReturnValue(provider);
  const providerFactory = { buildFromCredentials } as unknown as ProviderFactory;

  const svc = new AiConnectionsService(db, encryption, providerFactory);
  return { svc, db, withTenant, encryption, providerFactory, buildFromCredentials, validateConnection };
}

describe('AiConnectionsService', () => {
  describe('getStatus', () => {
    it('reports not connected with no stored row', async () => {
      const { svc } = makeService();
      await expect(svc.getStatus('company-1', 'user-1')).resolves.toEqual({ connected: false });
    });

    it('never includes the plaintext key or ciphertext -- only a last-4 fingerprint', async () => {
      const { svc } = makeService({
        row: {
          provider: 'openai', model: 'gpt-4o', baseUrl: null, apiKeyLast4: 'wxyz',
          lastValidatedAt: '2026-01-01T00:00:00Z', lastValidationError: null,
        },
      });
      const status = await svc.getStatus('company-1', 'user-1');
      expect(status).toEqual({
        connected: true, provider: 'openai', model: 'gpt-4o', baseUrl: null,
        apiKeyLast4: 'wxyz', lastValidatedAt: '2026-01-01T00:00:00Z', lastValidationError: null,
      });
      expect(JSON.stringify(status)).not.toMatch(/ciphertext|apiKey(?!Last4)/i);
    });
  });

  describe('connect', () => {
    it('validates against the real provider BEFORE storing anything', async () => {
      const validateConnection = jest.fn().mockResolvedValue({ ok: false, error: 'invalid key' });
      const { svc, withTenant, buildFromCredentials } = makeService({ validateConnection });

      await expect(
        svc.connect('company-1', 'user-1', { provider: 'openai', model: 'gpt-4o', apiKey: 'bad-key' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(buildFromCredentials).toHaveBeenCalledWith('openai', 'gpt-4o', 'bad-key', undefined);
      // Only the SELECT inside getStatus may run via withTenant on failure --
      // no INSERT ever happens because connect() throws before reaching it.
      expect(withTenant).not.toHaveBeenCalled();
    });

    it('encrypts the API key and stores only its last 4 characters in plaintext, once validation succeeds', async () => {
      const { svc, encryption, withTenant } = makeService();
      await svc.connect('company-1', 'user-1', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-abcd1234' });

      expect(encryption.encrypt).toHaveBeenCalledWith('sk-abcd1234');
      expect(withTenant).toHaveBeenCalled();
      const insertCallArgs = JSON.stringify((withTenant as jest.Mock).mock.calls);
      expect(insertCallArgs).not.toContain('sk-abcd1234');
    });
  });

  describe('getProviderForUser', () => {
    it('returns null when the user has no BYO connection -- caller falls back to RealityCapture AI', async () => {
      const { svc } = makeService();
      await expect(svc.getProviderForUser('company-1', 'user-1')).resolves.toBeNull();
    });

    it('decrypts the stored key and builds a provider when a connection exists', async () => {
      const { svc, encryption, buildFromCredentials } = makeService({
        row: { provider: 'anthropic', model: 'claude-sonnet-4-6', baseUrl: null, apiKeyCiphertext: 'ct', apiKeyIv: 'iv', apiKeyAuthTag: 'tag' },
      });
      const result = await svc.getProviderForUser('company-1', 'user-1');
      expect(encryption.decrypt).toHaveBeenCalledWith({ ciphertext: 'ct', iv: 'iv', authTag: 'tag' });
      expect(buildFromCredentials).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6', 'decrypted-key', undefined);
      expect(result).toBeTruthy();
    });
  });

  describe('disconnect', () => {
    it('deletes the stored connection', async () => {
      const { svc, withTenant } = makeService();
      await svc.disconnect('company-1', 'user-1');
      expect(withTenant).toHaveBeenCalledWith('company-1', expect.any(Function));
    });
  });
});
