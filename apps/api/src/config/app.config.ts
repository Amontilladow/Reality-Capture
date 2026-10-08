// apps/api/src/config/app.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173',
  apiUrl: process.env.API_URL ?? 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8001',
  internalServiceSecret: process.env.INTERNAL_SERVICE_SECRET ?? '',
  // Used by CredentialEncryptionService (common/crypto/) to derive the
  // AES-256-GCM key for BYO AI provider credentials. Must be a long,
  // random, secret value in production -- CHANGE THIS before deploying.
  credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? '',
}));
