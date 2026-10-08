import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

export interface EncryptedCredential {
  ciphertext: string; // base64
  iv: string;         // base64
  authTag: string;    // base64
}

// Standard AES-256-GCM authenticated encryption for a reversible,
// server-side-only secret -- specifically, a BYO AI provider API key
// (apps/api/src/modules/ai-connections/). There was no reusable
// encryption-at-rest helper anywhere in this codebase before this: the
// only precedent for a third-party credential (Google Calendar OAuth
// tokens, workforce/calendar-integration) stores them in plaintext, which
// this deliberately does not copy forward. API Keys (modules/api-keys) use
// a one-way SHA-256 hash instead, which only works when you need to
// *compare* a secret, not read it back to call a provider with it.
//
// The encryption key is derived (scrypt) from CREDENTIAL_ENCRYPTION_KEY,
// read via ConfigService the same way every other secret in this app is
// (e.g. jwt.accessSecret) -- never hard-coded, never logged. A fresh
// random IV and the GCM auth tag are stored alongside the ciphertext per
// row (user_ai_connections), not reused across rows.
@Injectable()
export class CredentialEncryptionService {
  private readonly logger = new Logger(CredentialEncryptionService.name);
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.get<string>('app.credentialEncryptionKey');
    if (!secret) {
      this.logger.warn('CREDENTIAL_ENCRYPTION_KEY is not set -- BYO AI credential storage will fail until it is configured.');
    }
    // scrypt turns an arbitrary-length passphrase into exactly 32 bytes
    // (AES-256's key size), same purpose a KDF always serves -- the raw
    // env var is never used directly as the AES key.
    this.key = scryptSync(secret ?? 'dev-only-insecure-placeholder-key', 'rc-credential-encryption', 32);
  }

  encrypt(plaintext: string): EncryptedCredential {
    const iv = randomBytes(12); // 96-bit IV, the GCM-recommended size
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(encrypted: EncryptedCredential): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
