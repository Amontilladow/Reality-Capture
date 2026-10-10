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

  // Phase 6 security fix: this used to assert the OPPOSITE -- that the
  // service kept working via a hardcoded 'dev-only-insecure-placeholder-key'
  // fallback when unconfigured. That silently encrypted every OAuth token
  // and BYO AI key with a key visible in this source file whenever an
  // operator forgot to set CREDENTIAL_ENCRYPTION_KEY. app.config.ts's
  // requireStrongSecret() is now the primary gate (the app fails to boot at
  // all without a real key), but this asserts the service itself also
  // never silently accepts a missing key, as defense in depth.
  it('throws rather than falling back to an insecure default when no encryption key is configured', () => {
    expect(() => makeService(undefined)).toThrow();
  });
});
