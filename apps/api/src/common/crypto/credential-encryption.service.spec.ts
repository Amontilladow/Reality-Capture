import type { ConfigService } from '@nestjs/config';
import { CredentialEncryptionService } from './credential-encryption.service';

function makeService(secret: string | undefined) {
  const config = { get: jest.fn().mockReturnValue(secret) } as unknown as ConfigService;
  return new CredentialEncryptionService(config);
}

describe('CredentialEncryptionService', () => {
  it('round-trips a plaintext secret', () => {
    const svc = makeService('a-real-encryption-key');
    const encrypted = svc.encrypt('sk-super-secret-api-key');
    expect(svc.decrypt(encrypted)).toBe('sk-super-secret-api-key');
  });

  it('never stores the plaintext anywhere in the encrypted output', () => {
    const svc = makeService('a-real-encryption-key');
    const encrypted = svc.encrypt('sk-super-secret-api-key');
    expect(encrypted.ciphertext).not.toContain('sk-super-secret-api-key');
    expect(JSON.stringify(encrypted)).not.toContain('sk-super-secret-api-key');
  });

  it('produces a different ciphertext each time (random IV), even for the same plaintext', () => {
    const svc = makeService('a-real-encryption-key');
    const a = svc.encrypt('same-value');
    const b = svc.encrypt('same-value');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('fails to decrypt with a tampered auth tag (detects corruption/tampering)', () => {
    const svc = makeService('a-real-encryption-key');
    const encrypted = svc.encrypt('sk-super-secret-api-key');
    const tampered = { ...encrypted, authTag: svc.encrypt('other').authTag };
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('still works (with a logged warning) when no encryption key is configured, rather than crashing at construction', () => {
    const svc = makeService(undefined);
    const encrypted = svc.encrypt('fallback-path');
    expect(svc.decrypt(encrypted)).toBe('fallback-path');
  });
});
