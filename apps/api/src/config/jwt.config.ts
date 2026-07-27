import { registerAs } from '@nestjs/config';
export default registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change-me-in-production-access',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change-me-in-production-refresh',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
}));