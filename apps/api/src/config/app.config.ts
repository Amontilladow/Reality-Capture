// apps/api/src/config/app.config.ts
import { registerAs } from '@nestjs/config';

const MIN_SECRET_LENGTH = 32;

// Phase 6 security fix: mirrors jwt.config.ts's requireStrongSecret() --
// fails the process at startup rather than letting CredentialEncryptionService
// silently fall back to its hardcoded 'dev-only-insecure-placeholder-key'
// string (committed in common/crypto/credential-encryption.service.ts) when
// this var is unset. That fallback previously let the app boot fine (just a
// warning log) while every OAuth token (Outlook/Gmail) and every BYO AI
// provider API key got encrypted with a key anyone with read access to this
// repo can derive -- confirmed as a Critical finding by the Phase 6 audit,
// independently flagged by two separate reviews. CREDENTIAL_ENCRYPTION_KEY
// was also missing from .env.example and render.yaml entirely; both are
// fixed alongside this change.
function requireStrongSecret(envVar: string): string {
  const value = process.env[envVar];
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${envVar} must be set to a random string of at least ${MIN_SECRET_LENGTH} characters.`);
  }
  return value;
}

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173',
  apiUrl: process.env.API_URL ?? 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8001',
  internalServiceSecret: process.env.INTERNAL_SERVICE_SECRET ?? '',
  // Used by CredentialEncryptionService (common/crypto/) to derive the
  // AES-256-GCM key for OAuth email-integration tokens and BYO AI provider
  // credentials. No insecure fallback -- the process refuses to start
  // without a real, sufficiently random value set.
  credentialEncryptionKey: requireStrongSecret('CREDENTIAL_ENCRYPTION_KEY'),
}));
