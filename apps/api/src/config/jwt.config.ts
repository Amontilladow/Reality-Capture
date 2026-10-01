import { registerAs } from '@nestjs/config';

const MIN_SECRET_LENGTH = 32;

// Fails the process at startup rather than silently signing/verifying every
// JWT with a well-known fallback string -- the old `?? 'change-me-in-...'`
// default meant any deployment that forgot to set these env vars (or, on
// docker-compose, left them unset so Compose substituted an empty string,
// which `??` doesn't catch since '' is not null/undefined) would boot
// successfully and issue forgeable tokens for any user/company/role.
function requireStrongSecret(envVar: string): string {
  const value = process.env[envVar];
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${envVar} must be set to a random string of at least ${MIN_SECRET_LENGTH} characters.`);
  }
  return value;
}

export default registerAs('jwt', () => ({
  accessSecret: requireStrongSecret('JWT_ACCESS_SECRET'),
  refreshSecret: requireStrongSecret('JWT_REFRESH_SECRET'),
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
}));